import { z } from "zod";

import { isoTimestampSchema } from "../../domain/authorization.js";
import { persistedJsonValueSchema } from "../../domain/plain-data.js";

export const MAX_CALLE_RESPONSE_BYTES = 1_048_576;

const MAX_EXTERNAL_STRING_LENGTH = 4_000;
const MAX_TRANSCRIPT_TURNS = 500;
const MAX_EVIDENCE_ENTRIES = 50;
const MAX_EVENTS = 50;
const MAX_ATTEMPTS = 50;

const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const CALL_ID_PATTERN = /^call_[A-Za-z0-9_-]+$/;

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

const boundedStringSchema = z
  .string()
  .max(MAX_EXTERNAL_STRING_LENGTH)
  .refine(
    (value) =>
      !UNSAFE_CONTROL_PATTERN.test(value) && hasOnlyPairedSurrogates(value),
  );
const boundedSingleLineStringSchema = boundedStringSchema.refine(
  (value) => !CONTROL_CHARACTER_PATTERN.test(value),
);
const identifierSchema = boundedSingleLineStringSchema
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value && hasOnlyPairedSurrogates(value));
const callIdSchema = identifierSchema.regex(CALL_ID_PATTERN);
const cursorSchema = boundedSingleLineStringSchema
  .min(1)
  .max(256)
  .refine(hasOnlyPairedSurrogates);
const providerStatusSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const callStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
]);

const boundedJsonObjectSchema = persistedJsonValueSchema
  .refine(
    (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value),
  )
  .transform((value) => value as Readonly<Record<string, unknown>>);

export const providerRecipientResultSchema = z.strictObject({
  contact_outcome: z.enum(["reached", "declined", "no_answer", "unknown"]),
  confirmed_quantity: z.number().int().nonnegative().max(1_000_000),
  available_quantity: z.number().int().nonnegative().max(1_000_000),
  delayed_quantity: z.number().int().nonnegative().max(1_000_000),
  promised_delivery_date: boundedStringSchema.max(32),
  delay_reason: boundedStringSchema.max(1_000),
  follow_up_required: z.enum(["yes", "no", "unknown"]),
  unable_to_fulfill: z.enum(["yes", "no", "unknown"]),
});

const completionConfidenceSchema = z.strictObject({
  score: z.number().finite().min(0).max(1),
  label: boundedSingleLineStringSchema.min(1).max(120),
});

const transcriptTurnSchema = z.strictObject({
  offset_seconds: z.number().int().nonnegative().nullable(),
  speaker: z.enum(["bot", "user", "unknown"]),
  text: boundedStringSchema,
});

const attemptSchema = z.strictObject({
  id: identifierSchema,
  phone: boundedSingleLineStringSchema.min(1).max(128),
  status: z.enum([
    "queued",
    "dialing",
    "in_progress",
    "completed",
    "failed",
    "canceled",
  ]),
  started_at: isoTimestampSchema.nullable(),
  completed_at: isoTimestampSchema.nullable(),
  summary: boundedStringSchema.nullable(),
  transcript_turns: z.array(transcriptTurnSchema).max(MAX_TRANSCRIPT_TURNS),
  provider_call_id: identifierSchema.nullable(),
  failure_code: boundedSingleLineStringSchema.min(1).nullable(),
  failure_message: boundedStringSchema.min(1).nullable(),
});

const recipientSchema = z.strictObject({
  id: identifierSchema,
  phones: z.array(boundedSingleLineStringSchema.min(1).max(128)).min(1).max(50),
  locale: boundedSingleLineStringSchema.min(1).max(64).nullable(),
  region: boundedSingleLineStringSchema.min(1).max(64).nullable(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  structured_result: providerRecipientResultSchema.nullable(),
  summary: boundedStringSchema.nullable(),
  attempts: z.array(attemptSchema).max(MAX_ATTEMPTS),
});

function isTruthfulNoAnswer(
  result: z.infer<typeof providerRecipientResultSchema>,
): boolean {
  return (
    result.confirmed_quantity === 0 &&
    result.available_quantity === 0 &&
    result.delayed_quantity === 0 &&
    result.promised_delivery_date === "unknown" &&
    result.delay_reason === "unknown" &&
    result.follow_up_required === "unknown" &&
    result.unable_to_fulfill === "unknown"
  );
}

export const callResourceSchema = z
  .strictObject({
    id: callIdSchema,
    object: z.literal("call_task"),
    status: providerStatusSchema,
    task: boundedStringSchema.min(1),
    recipients: z.array(recipientSchema).length(1),
    structured_result: boundedJsonObjectSchema.nullable(),
    summary: boundedStringSchema.nullable(),
    task_completed: z.boolean().nullable(),
    completion_confidence: completionConfidenceSchema.nullable(),
    evidence: z.array(boundedStringSchema).max(MAX_EVIDENCE_ENTRIES),
    metadata: boundedJsonObjectSchema,
    failure_code: boundedSingleLineStringSchema.min(1).nullable(),
    failure_message: boundedStringSchema.min(1).nullable(),
    created_at: isoTimestampSchema,
    completed_at: isoTimestampSchema.nullable(),
  })
  .superRefine((resource, context) => {
    const transcriptCount = resource.recipients.reduce(
      (recipientTotal, recipient) =>
        recipientTotal +
        recipient.attempts.reduce(
          (attemptTotal, attempt) =>
            attemptTotal + attempt.transcript_turns.length,
          0,
        ),
      0,
    );
    if (transcriptCount > MAX_TRANSCRIPT_TURNS) {
      context.addIssue({ code: "custom", message: "Invalid transcript" });
    }

    const recipient = resource.recipients[0];
    const result = recipient?.structured_result;
    if (result?.contact_outcome !== "no_answer") {
      return;
    }

    if (
      !isTruthfulNoAnswer(result) ||
      resource.task_completed !== false ||
      resource.completion_confidence !== null ||
      resource.structured_result !== null ||
      resource.evidence.length !== 0 ||
      recipient.attempts.some(
        (attempt) => attempt.transcript_turns.length !== 0,
      )
    ) {
      context.addIssue({ code: "custom", message: "Invalid no-answer result" });
    }
  });

const eventSchema = z.strictObject({
  id: identifierSchema,
  type: boundedSingleLineStringSchema.min(1).max(128),
  call_id: callIdSchema,
  created_at: isoTimestampSchema,
  level: z.enum(["debug", "info", "warning", "error"]),
  status: callStatusSchema,
  message: boundedStringSchema,
  details: boundedJsonObjectSchema,
});

export const eventsPageSchema = z.strictObject({
  object: z.literal("list"),
  data: z.array(eventSchema).max(MAX_EVENTS),
  next_cursor: cursorSchema.nullable().optional(),
});

export type ProviderCallResource = z.infer<typeof callResourceSchema>;
export type ProviderEventsPage = z.infer<typeof eventsPageSchema>;
