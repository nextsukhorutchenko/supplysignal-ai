import type {
  CalleCallSnapshot,
  CalleEventPage,
  CalleGateway,
  CreateSupplierCall,
} from "../../application/ports.js";
import { AppError, type AppErrorCode } from "../../domain/errors.js";
import { prepareCreateCallRequest } from "./request.js";
import { mapCallResource, mapEventsPage } from "./mapper.js";
import { MAX_CALLE_RESPONSE_BYTES } from "./schemas.js";

const CREATE_REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const READ_REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const GET_RETRY_DELAYS = [500, 1_000] as const;
const MAX_API_KEY_LENGTH = 4_000;
const MAX_CALL_ID_LENGTH = 128;
const MAX_CURSOR_LENGTH = 256;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const CALL_ID_PATTERN = /^call_[A-Za-z0-9_-]+$/;
const TRANSIENT_GET_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type CalleErrorKind =
  | "ambiguous_create"
  | "idempotency_conflict"
  | "creation_rejected"
  | "call_not_ready"
  | "provider_result_invalid"
  | "read_failed";

export class CalleError extends AppError {
  constructor(
    code: AppErrorCode,
    readonly kind: CalleErrorKind,
  ) {
    super(code);
    this.name = "CalleError";
  }
}

export type CalleClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

function error(code: AppErrorCode, kind: CalleErrorKind): CalleError {
  return new CalleError(code, kind);
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw error("CALL_CREATION_FAILED", "creation_rejected");
    }
    return url.origin;
  } catch {
    throw error("CALL_CREATION_FAILED", "creation_rejected");
  }
}

function requireBoundedHeaderValue(value: string, maximumLength: number): void {
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !hasOnlyPairedSurrogates(value)
  ) {
    throw error("CALL_CREATION_FAILED", "creation_rejected");
  }
}

function hasOnlyPairedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function encodePathIdentifier(
  value: string,
  maximumLength: number,
  pattern?: RegExp,
): string {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !hasOnlyPairedSurrogates(value) ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw error("CALL_NOT_READY", "call_not_ready");
  }
  try {
    return encodeURIComponent(value);
  } catch {
    throw error("CALL_NOT_READY", "call_not_ready");
  }
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
    }
    const length = Number(declaredLength);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_CALLE_RESPONSE_BYTES
    ) {
      throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
    }
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_CALLE_RESPONSE_BYTES) {
        await reader.cancel();
        throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
      }
      chunks.push(next.value);
    }
  } catch {
    throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
  }
}

export class CalleClient implements CalleGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: CalleClientOptions) {
    requireBoundedHeaderValue(options.apiKey, MAX_API_KEY_LENGTH);
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async createCall(input: CreateSupplierCall): Promise<CalleCallSnapshot> {
    let prepared: ReturnType<typeof prepareCreateCallRequest>;
    let body: string;
    try {
      prepared = prepareCreateCallRequest(input);
      requireBoundedHeaderValue(
        prepared.canonicalInput.idempotencyKey,
        MAX_IDEMPOTENCY_KEY_LENGTH,
      );
      body = JSON.stringify(prepared.request);
    } catch {
      throw error("CALL_CREATION_FAILED", "creation_rejected");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/calls`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": prepared.canonicalInput.idempotencyKey,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(CREATE_REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      throw error("CALL_OUTCOME_PENDING", "ambiguous_create");
    }

    if (response.status === 409) {
      throw error("CALL_CREATION_FAILED", "idempotency_conflict");
    }
    if (response.status !== 201) {
      if (response.status >= 200 && response.status < 300) {
        throw error("CALL_OUTCOME_PENDING", "ambiguous_create");
      }
      if (
        response.status >= 500 ||
        TRANSIENT_GET_STATUSES.has(response.status)
      ) {
        throw error("CALL_OUTCOME_PENDING", "ambiguous_create");
      }
      throw error("CALL_CREATION_FAILED", "creation_rejected");
    }

    try {
      return mapCallResource(await readBoundedJson(response));
    } catch {
      throw error("CALL_OUTCOME_PENDING", "ambiguous_create");
    }
  }

  async getCall(callId: string): Promise<CalleCallSnapshot> {
    const encodedCallId = encodePathIdentifier(
      callId,
      MAX_CALL_ID_LENGTH,
      CALL_ID_PATTERN,
    );
    return this.readGet(
      `${this.baseUrl}/v1/calls/${encodedCallId}`,
      mapCallResource,
    );
  }

  async listEvents(callId: string, cursor?: string): Promise<CalleEventPage> {
    const encodedCallId = encodePathIdentifier(
      callId,
      MAX_CALL_ID_LENGTH,
      CALL_ID_PATTERN,
    );
    const encodedCursor =
      cursor === undefined
        ? ""
        : `?cursor=${encodePathIdentifier(cursor, MAX_CURSOR_LENGTH)}`;
    return this.readGet(
      `${this.baseUrl}/v1/calls/${encodedCallId}/events${encodedCursor}`,
      mapEventsPage,
    );
  }

  private async readGet<T>(
    url: string,
    map: (input: unknown) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt <= GET_RETRY_DELAYS.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { authorization: `Bearer ${this.apiKey}` },
          redirect: "error",
          signal: AbortSignal.timeout(READ_REQUEST_TIMEOUT_MILLISECONDS),
        });
      } catch {
        if (attempt < GET_RETRY_DELAYS.length) {
          await this.sleepBeforeRetry(attempt);
          continue;
        }
        throw error("CALL_OUTCOME_PENDING", "read_failed");
      }

      if (TRANSIENT_GET_STATUSES.has(response.status)) {
        if (attempt < GET_RETRY_DELAYS.length) {
          await this.sleepBeforeRetry(attempt);
          continue;
        }
        throw error("CALL_OUTCOME_PENDING", "read_failed");
      }

      if (response.status !== 200) {
        if (response.status >= 200 && response.status < 300) {
          throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
        }
        throw error("CALL_NOT_READY", "call_not_ready");
      }

      try {
        return map(await readBoundedJson(response));
      } catch {
        throw error("PROVIDER_RESULT_INVALID", "provider_result_invalid");
      }
    }

    throw error("CALL_OUTCOME_PENDING", "read_failed");
  }

  private async sleepBeforeRetry(attempt: number): Promise<void> {
    const delay = GET_RETRY_DELAYS[attempt];
    if (delay === undefined) {
      throw error("CALL_OUTCOME_PENDING", "read_failed");
    }
    try {
      await this.sleep(delay);
    } catch {
      throw error("CALL_OUTCOME_PENDING", "read_failed");
    }
  }
}
