import { z } from "zod";

import {
  callAuthorizationSchema,
  isoTimestampSchema,
  type CallAuthorization,
} from "./authorization.js";
import { callRecipientSchema, type CallRecipient } from "./call-recipient.js";
import { purchaseOrderSchema, type PurchaseOrder } from "./purchase-order.js";
import { supplyRiskSchema, type SupplyRisk } from "./risk.js";
import {
  canCompleteRun,
  trustStatusSchema,
  type TrustStatus,
} from "./trust.js";

const MAX_RUN_ID_LENGTH = 128;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CALL_ID_LENGTH = 128;
const MAX_TRANSCRIPT_ITEMS = 120;
const MAX_TRANSCRIPT_TEXT_LENGTH = 4_000;
const MAX_EVIDENCE_ITEMS = 120;
const MAX_EVIDENCE_ID_LENGTH = 128;
const MAX_EVIDENCE_EXCERPT_LENGTH = 1_000;
const MAX_TURN_INDEXES = 120;
const MAX_TURN_INDEX = 9_999;
const MAX_CONFIDENCE_LABEL_LENGTH = 120;
const MAX_PERSISTED_JSON_DEPTH = 8;
const MAX_PERSISTED_JSON_CONTAINER_ENTRIES = 128;
const MAX_PERSISTED_JSON_KEY_LENGTH = 256;
const MAX_PERSISTED_JSON_STRING_LENGTH = 4_096;
const MAX_PERSISTED_JSON_SERIALIZED_LENGTH = 32_768;

const RUN_STATUSES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "CALL_STARTING",
  "CALL_IN_PROGRESS",
  "RECONCILING",
  "PROVIDER_REPORTED_TERMINAL",
  "COMPLETED",
  "OUTCOME_UNKNOWN",
  "FAILED",
] as const;

const PROVIDER_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
  "unknown",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type ProviderEvidenceSnapshot = {
  callId: string;
  status: (typeof PROVIDER_STATUSES)[number];
  observedAt: string;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  transcript: readonly { speaker: "bot" | "user" | "unknown"; text: string }[];
  structuredResult: unknown;
  evidence: readonly {
    id: string;
    excerpt: string;
    turnIndexes: readonly number[];
  }[];
};

export type RunRecord = {
  id: string;
  version: number;
  status: RunStatus;
  trustStatus: TrustStatus;
  order: PurchaseOrder;
  recipient: CallRecipient;
  authorization?: CallAuthorization;
  idempotencyKey?: string;
  requestDigest?: string;
  callId?: string;
  providerSnapshot?: ProviderEvidenceSnapshot;
  schemaValidation: "not_run" | "passed" | "failed";
  consistencyValidation: "not_run" | "passed" | "failed";
  humanReview?: unknown;
  risk?: SupplyRisk;
  artifactState: "none" | "ready" | "published" | "failed";
  createdAt: string;
  updatedAt: string;
};

type JsonBudget = {
  serializedLength: number;
};

function addSerializedLength(budget: JsonBudget, length: number): boolean {
  budget.serializedLength += length;
  return budget.serializedLength <= MAX_PERSISTED_JSON_SERIALIZED_LENGTH;
}

function isBoundedJsonValue(value: unknown): boolean {
  try {
    return visitJsonValue(value, 0, new Set<object>(), { serializedLength: 0 });
  } catch {
    return false;
  }
}

function visitJsonValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  budget: JsonBudget,
): boolean {
  if (depth > MAX_PERSISTED_JSON_DEPTH) {
    return false;
  }

  if (value === null) {
    return addSerializedLength(budget, 4);
  }

  if (typeof value === "string") {
    return (
      value.length <= MAX_PERSISTED_JSON_STRING_LENGTH &&
      addSerializedLength(budget, JSON.stringify(value).length)
    );
  }

  if (typeof value === "boolean") {
    return addSerializedLength(budget, value ? 4 : 5);
  }

  if (typeof value === "number") {
    return (
      Number.isFinite(value) &&
      addSerializedLength(budget, JSON.stringify(value).length)
    );
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_PERSISTED_JSON_CONTAINER_ENTRIES ||
      !addSerializedLength(budget, 2)
    ) {
      return false;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.some(
        (key) =>
          (typeof key !== "string" || key !== "length") &&
          (typeof key !== "string" ||
            !/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= value.length),
      )
    ) {
      return false;
    }

    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        (index > 0 && !addSerializedLength(budget, 1)) ||
        !visitJsonValue(descriptor.value, depth + 1, ancestors, budget)
      ) {
        ancestors.delete(value);
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length > MAX_PERSISTED_JSON_CONTAINER_ENTRIES ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" || key.length > MAX_PERSISTED_JSON_KEY_LENGTH,
    ) ||
    !addSerializedLength(budget, 2)
  ) {
    return false;
  }

  ancestors.add(value);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string") {
      ancestors.delete(value);
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      (index > 0 && !addSerializedLength(budget, 1)) ||
      !addSerializedLength(budget, JSON.stringify(key).length + 1) ||
      !visitJsonValue(descriptor.value, depth + 1, ancestors, budget)
    ) {
      ancestors.delete(value);
      return false;
    }
  }
  ancestors.delete(value);
  return true;
}

const boundedJsonValueSchema = z
  .unknown()
  .refine(isBoundedJsonValue, "Expected a bounded JSON value");

function hasAccessorBackedOwnProperty(input: object): boolean {
  return Reflect.ownKeys(input).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor === undefined || !("value" in descriptor);
  });
}

function preflightProviderEvidenceInput(input: unknown): unknown {
  try {
    if (
      input !== null &&
      typeof input === "object" &&
      hasAccessorBackedOwnProperty(input)
    ) {
      return null;
    }

    return input;
  } catch {
    return null;
  }
}

function preflightRunRecordInput(input: unknown): unknown {
  try {
    if (input === null || typeof input !== "object") {
      return input;
    }

    if (hasAccessorBackedOwnProperty(input)) {
      return null;
    }

    const humanReview = Object.getOwnPropertyDescriptor(input, "humanReview");
    return humanReview !== undefined && humanReview.value === undefined
      ? null
      : input;
  } catch {
    return null;
  }
}

export const runStatusSchema = z.enum(RUN_STATUSES);

const providerEvidenceSnapshotObjectSchema: z.ZodType<ProviderEvidenceSnapshot> =
  z.strictObject({
    callId: z.string().trim().min(1).max(MAX_CALL_ID_LENGTH),
    status: z.enum(PROVIDER_STATUSES),
    observedAt: isoTimestampSchema,
    taskCompleted: z.boolean().nullable(),
    completionConfidence: z
      .strictObject({
        score: z.number().finite().min(0).max(1),
        label: z.string().trim().min(1).max(MAX_CONFIDENCE_LABEL_LENGTH),
      })
      .nullable(),
    transcript: z
      .array(
        z.strictObject({
          speaker: z.enum(["bot", "user", "unknown"]),
          text: z.string().max(MAX_TRANSCRIPT_TEXT_LENGTH),
        }),
      )
      .max(MAX_TRANSCRIPT_ITEMS)
      .readonly(),
    structuredResult: boundedJsonValueSchema,
    evidence: z
      .array(
        z.strictObject({
          id: z.string().trim().min(1).max(MAX_EVIDENCE_ID_LENGTH),
          excerpt: z.string().max(MAX_EVIDENCE_EXCERPT_LENGTH),
          turnIndexes: z
            .array(z.number().int().nonnegative().max(MAX_TURN_INDEX))
            .max(MAX_TURN_INDEXES)
            .readonly(),
        }),
      )
      .max(MAX_EVIDENCE_ITEMS)
      .readonly(),
  });

export const providerEvidenceSnapshotSchema: z.ZodType<ProviderEvidenceSnapshot> =
  z.preprocess(
    preflightProviderEvidenceInput,
    providerEvidenceSnapshotObjectSchema,
  );

const runRecordObjectSchema: z.ZodType<RunRecord> = z
  .strictObject({
    id: z.string().trim().min(1).max(MAX_RUN_ID_LENGTH),
    version: z.number().int().nonnegative(),
    status: runStatusSchema,
    trustStatus: trustStatusSchema,
    order: purchaseOrderSchema,
    recipient: callRecipientSchema,
    authorization: callAuthorizationSchema.optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(MAX_IDENTIFIER_LENGTH)
      .optional(),
    requestDigest: z
      .string()
      .trim()
      .min(1)
      .max(MAX_IDENTIFIER_LENGTH)
      .optional(),
    callId: z.string().trim().min(1).max(MAX_CALL_ID_LENGTH).optional(),
    providerSnapshot: providerEvidenceSnapshotSchema.optional(),
    schemaValidation: z.enum(["not_run", "passed", "failed"]),
    consistencyValidation: z.enum(["not_run", "passed", "failed"]),
    humanReview: boundedJsonValueSchema.optional(),
    risk: supplyRiskSchema.optional(),
    artifactState: z.enum(["none", "ready", "published", "failed"]),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .superRefine((run, context) => {
    if (
      run.status === "COMPLETED" &&
      (run.schemaValidation !== "passed" ||
        run.consistencyValidation !== "passed" ||
        run.trustStatus !== "HUMAN_CONFIRMED" ||
        run.artifactState !== "published")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Completed runs require validated, human-confirmed published artifacts",
      });
    }
  });

export const runRecordSchema: z.ZodType<RunRecord> = z.preprocess(
  preflightRunRecordInput,
  runRecordObjectSchema,
);

const ALLOWED_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  DRAFT: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["CALL_STARTING"],
  CALL_STARTING: ["CALL_IN_PROGRESS", "RECONCILING", "FAILED"],
  CALL_IN_PROGRESS: ["RECONCILING", "PROVIDER_REPORTED_TERMINAL", "FAILED"],
  RECONCILING: [
    "CALL_STARTING",
    "CALL_IN_PROGRESS",
    "PROVIDER_REPORTED_TERMINAL",
    "OUTCOME_UNKNOWN",
    "FAILED",
  ],
  PROVIDER_REPORTED_TERMINAL: ["COMPLETED", "OUTCOME_UNKNOWN", "FAILED"],
  COMPLETED: [],
  OUTCOME_UNKNOWN: [],
  FAILED: [],
};

export class DomainError extends Error {
  readonly code = "RUN_TRANSITION_FORBIDDEN" as const;

  constructor() {
    super("RUN_TRANSITION_FORBIDDEN");
    this.name = "DomainError";
  }
}

export function transitionRun(run: RunRecord, next: RunStatus): RunRecord {
  if (
    !ALLOWED_TRANSITIONS[run.status].includes(next) ||
    (next === "COMPLETED" && !canCompleteRun(run))
  ) {
    throw new DomainError();
  }

  return { ...run, status: next, version: run.version + 1 };
}
