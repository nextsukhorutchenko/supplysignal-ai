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
  if (resource.recipient_result === null) {
    if (resource.status === "completed") {
      throw invalidProviderResult();
    }
    return null;
  }

  const result = supplierResponseFactsSchema.safeParse({
    contactOutcome: resource.recipient_result.contact_outcome,
    confirmedQuantity: resource.recipient_result.confirmed_quantity,
    availableQuantity: resource.recipient_result.available_quantity,
    delayedQuantity: resource.recipient_result.delayed_quantity,
    promisedDeliveryDate: resource.recipient_result.promised_delivery_date,
    delayReason: resource.recipient_result.delay_reason,
    followUpRequired: resource.recipient_result.follow_up_required,
    unableToFulfill: resource.recipient_result.unable_to_fulfill,
  });

  if (!result.success) {
    throw invalidProviderResult();
  }

  return result.data;
}

function mapSpeaker(
  speaker: ProviderCallResource["transcript"][number]["speaker"],
): "bot" | "user" | "unknown" {
  if (speaker === "assistant") {
    return "bot";
  }
  return speaker;
}

export function mapCallResource(input: unknown): CalleCallSnapshot {
  const resource = callResourceSchema.safeParse(input);

  if (!resource.success) {
    throw invalidProviderResult();
  }

  const snapshot = providerEvidenceSnapshotSchema.safeParse({
    callId: resource.data.call_id,
    status: KNOWN_PROVIDER_STATUSES.has(resource.data.status)
      ? resource.data.status
      : "unknown",
    observedAt: resource.data.updated_at,
    taskCompleted: resource.data.task_completed,
    completionConfidence: resource.data.completion_confidence,
    transcript: resource.data.transcript.map((turn) => ({
      speaker: mapSpeaker(turn.speaker),
      text: turn.text,
    })),
    structuredResult: mapStructuredResult(resource.data),
    evidence: resource.data.evidence.map((item) => ({
      id: item.id,
      excerpt: item.excerpt,
      turnIndexes: item.turn_indexes,
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
    events: page.data.events.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurred_at,
      summary: event.summary,
    })),
    nextCursor: page.data.next_cursor,
  };
}
