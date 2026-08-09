import { z } from "zod";

import { isoTimestampSchema } from "../../domain/authorization.js";

export const MAX_CALLE_RESPONSE_BYTES = 1_048_576;

const MAX_EXTERNAL_STRING_LENGTH = 4_000;
const MAX_TRANSCRIPT_TURNS = 500;
const MAX_EVIDENCE_ENTRIES = 50;
const MAX_EVENTS = 50;

const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const boundedStringSchema = z
  .string()
  .max(MAX_EXTERNAL_STRING_LENGTH)
  .refine((value) => !UNSAFE_CONTROL_PATTERN.test(value));
const boundedSingleLineStringSchema = z
  .string()
  .max(MAX_EXTERNAL_STRING_LENGTH)
  .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value));
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => value.trim() === value && !CONTROL_CHARACTER_PATTERN.test(value),
  );
const providerStatusSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

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
  speaker: z.enum(["assistant", "user", "unknown"]),
  text: boundedStringSchema,
});

const evidenceSchema = z.strictObject({
  id: identifierSchema,
  excerpt: boundedStringSchema,
  turn_indexes: z.array(z.number().int().nonnegative().max(9_999)).max(120),
});

export const callResourceSchema = z.strictObject({
  call_id: identifierSchema,
  status: providerStatusSchema,
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  task_completed: z.boolean().nullable(),
  completion_confidence: completionConfidenceSchema.nullable(),
  transcript: z.array(transcriptTurnSchema).max(MAX_TRANSCRIPT_TURNS),
  recipient_result: providerRecipientResultSchema.nullable(),
  evidence: z.array(evidenceSchema).max(MAX_EVIDENCE_ENTRIES),
});

const eventSchema = z.strictObject({
  id: identifierSchema,
  type: boundedSingleLineStringSchema.min(1).max(128),
  occurred_at: isoTimestampSchema,
  summary: boundedStringSchema,
});

export const eventsPageSchema = z.strictObject({
  events: z.array(eventSchema).max(MAX_EVENTS),
  next_cursor: boundedSingleLineStringSchema.min(1).max(256).nullable(),
});

export type ProviderCallResource = z.infer<typeof callResourceSchema>;
export type ProviderEventsPage = z.infer<typeof eventsPageSchema>;
