import { AppError } from "./errors.js";
import {
  providerEvidenceSnapshotSchema,
  type ProviderEvidenceSnapshot,
} from "./run.js";
import {
  supplierResponseSchema,
  type SupplierResponse,
} from "./supplier-response.js";

export type PreflightEvidenceScenario = "answered" | "declined" | "no_answer";

export type ValidatedPreflightEvidence = Readonly<{
  snapshot: ProviderEvidenceSnapshot;
  response: SupplierResponse;
}>;

function invalid(): never {
  throw new AppError("PROVIDER_RESULT_INVALID");
}

function hasNonEmptyUserTurn(snapshot: ProviderEvidenceSnapshot): boolean {
  return snapshot.transcript.some(
    (turn) => turn.speaker === "user" && turn.text.trim().length > 0,
  );
}

function isTruthfulNoAnswer(
  snapshot: ProviderEvidenceSnapshot,
  response: SupplierResponse,
): boolean {
  return (
    response.contactOutcome === "no_answer" &&
    response.confirmedQuantity === 0 &&
    response.availableQuantity === 0 &&
    response.delayedQuantity === 0 &&
    response.promisedDeliveryDate === "unknown" &&
    response.delayReason === "unknown" &&
    response.followUpRequired === "unknown" &&
    response.unableToFulfill === "unknown" &&
    snapshot.taskCompleted === false &&
    snapshot.completionConfidence === null &&
    snapshot.transcript.length === 0 &&
    snapshot.evidence.length === 0
  );
}

export function validatePreflightEvidenceIntegrity(
  scenario: PreflightEvidenceScenario,
  input: unknown,
): ValidatedPreflightEvidence {
  const snapshotResult = providerEvidenceSnapshotSchema.safeParse(input);
  if (!snapshotResult.success || snapshotResult.data.status !== "completed") {
    return invalid();
  }

  const responseResult = supplierResponseSchema.safeParse(
    snapshotResult.data.structuredResult,
  );
  if (!responseResult.success) {
    return invalid();
  }

  const snapshot = snapshotResult.data;
  const response = responseResult.data;
  const acceptable =
    scenario === "no_answer"
      ? isTruthfulNoAnswer(snapshot, response)
      : hasNonEmptyUserTurn(snapshot) &&
        response.contactOutcome ===
          (scenario === "answered" ? "reached" : "declined");

  if (!acceptable) {
    return invalid();
  }

  return Object.freeze({ snapshot, response });
}
