import type {
  CalleCallSnapshot,
  CalleEventPage,
} from "../../application/ports.js";
import { AppError } from "../../domain/errors.js";
import { providerEvidenceSnapshotSchema } from "../../domain/run.js";
import { supplierResponseFactsSchema } from "../../domain/supplier-response.js";
import {
  callResourceSchema,
  eventsPageSchema,
  type ProviderCallResource,
} from "./schemas.js";

const KNOWN_PROVIDER_STATUSES = new Set([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
]);

function invalidProviderResult(): AppError {
  return new AppError("PROVIDER_RESULT_INVALID");
}

function mapStructuredResult(
  resource: ProviderCallResource,
): CalleCallSnapshot["structuredResult"] {
  const recipientResult = resource.recipients[0]?.structured_result ?? null;
  if (recipientResult === null) {
    if (resource.status === "completed") {
      throw invalidProviderResult();
    }
    return null;
  }

  const result = supplierResponseFactsSchema.safeParse({
    contactOutcome: recipientResult.contact_outcome,
    confirmedQuantity: recipientResult.confirmed_quantity,
    availableQuantity: recipientResult.available_quantity,
    delayedQuantity: recipientResult.delayed_quantity,
    promisedDeliveryDate: recipientResult.promised_delivery_date,
    delayReason: recipientResult.delay_reason,
    followUpRequired: recipientResult.follow_up_required,
    unableToFulfill: recipientResult.unable_to_fulfill,
  });

  if (!result.success) {
    throw invalidProviderResult();
  }

  return result.data;
}

function mapSpeaker(
  speaker: ProviderCallResource["recipients"][number]["attempts"][number]["transcript_turns"][number]["speaker"],
): "bot" | "user" | "unknown" {
  return speaker;
}

export function mapCallResource(input: unknown): CalleCallSnapshot {
  const resource = callResourceSchema.safeParse(input);

  if (!resource.success) {
    throw invalidProviderResult();
  }

  const snapshot = providerEvidenceSnapshotSchema.safeParse({
    callId: resource.data.id,
    status: KNOWN_PROVIDER_STATUSES.has(resource.data.status)
      ? resource.data.status
      : "unknown",
    observedAt: resource.data.completed_at ?? resource.data.created_at,
    taskCompleted: resource.data.task_completed,
    completionConfidence: resource.data.completion_confidence,
    transcript: resource.data.recipients.flatMap((recipient) =>
      recipient.attempts.flatMap((attempt) =>
        attempt.transcript_turns.map((turn) => ({
          speaker: mapSpeaker(turn.speaker),
          text: turn.text,
        })),
      ),
    ),
    structuredResult: mapStructuredResult(resource.data),
    evidence: resource.data.evidence.map((excerpt, index) => ({
      id: `evidence_${String(index + 1).padStart(3, "0")}`,
      excerpt,
      turnIndexes: [],
    })),
  });

  if (!snapshot.success) {
    throw invalidProviderResult();
  }

  return snapshot.data;
}

export function mapEventsPage(input: unknown): CalleEventPage {
  const page = eventsPageSchema.safeParse(input);

  if (!page.success) {
    throw invalidProviderResult();
  }

  return {
    events: page.data.data.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.created_at,
      summary: event.message,
    })),
    nextCursor: page.data.next_cursor ?? null,
  };
}
