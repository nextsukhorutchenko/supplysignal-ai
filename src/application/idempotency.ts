import { createHash } from "node:crypto";

import { z } from "zod";

import { withPlainDataBoundary } from "../domain/plain-data.js";
import { runRecordSchema, type RunRecord } from "../domain/run.js";

const digestInputSchema = withPlainDataBoundary(
  z.strictObject({
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
    authorizationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deriveCallRequestDigest(run: RunRecord): string {
  const canonical = runRecordSchema.parse(run);
  return `sha256:${sha256(
    canonicalJson({
      version: 1,
      runId: canonical.id,
      order: canonical.order,
      recipient: canonical.recipient,
    }),
  )}`;
}

export function deriveCallIdempotencyKey(input: {
  runId: string;
  authorizationDigest: string;
  requestDigest: string;
}): string {
  const canonical = digestInputSchema.parse(input);
  return `ssai-v1-${sha256(canonicalJson(canonical)).slice(0, 48)}`;
}

export function deriveCallIdentity(run: RunRecord): {
  readonly requestDigest: string;
  readonly idempotencyKey: string;
} {
  const canonical = runRecordSchema.parse(run);
  if (canonical.authorization === undefined) {
    throw new Error("AUTHORIZATION_REQUIRED");
  }
  const requestDigest = deriveCallRequestDigest(canonical);
  return {
    requestDigest,
    idempotencyKey: deriveCallIdempotencyKey({
      runId: canonical.id,
      authorizationDigest: canonical.authorization.authorizationDigest,
      requestDigest,
    }),
  };
}
