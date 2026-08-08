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

export const runStatusSchema = z.enum(RUN_STATUSES);

export const providerEvidenceSnapshotSchema: z.ZodType<ProviderEvidenceSnapshot> =
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
    structuredResult: z.unknown(),
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

export const runRecordSchema: z.ZodType<RunRecord> = z.strictObject({
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
  requestDigest: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
  callId: z.string().trim().min(1).max(MAX_CALL_ID_LENGTH).optional(),
  providerSnapshot: providerEvidenceSnapshotSchema.optional(),
  schemaValidation: z.enum(["not_run", "passed", "failed"]),
  consistencyValidation: z.enum(["not_run", "passed", "failed"]),
  humanReview: z.unknown().optional(),
  risk: supplyRiskSchema.optional(),
  artifactState: z.enum(["none", "ready", "published", "failed"]),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

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
