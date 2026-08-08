import { describe, expect, it } from "vitest";

import {
  type RunRecord,
  type RunStatus,
  runRecordSchema,
  transitionRun,
} from "./run.js";

const fictionalPhone = `+1${"2".repeat(10)}`;

function createRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
    version: 3,
    status: "DRAFT",
    trustStatus: "UNVERIFIED_PROVIDER_RESULT",
    order: {
      supplierName: "Northstar Components",
      purchaseOrderRef: "PO-2048",
      expectedQuantity: 500,
      requiredDeliveryDate: "2026-08-15",
    },
    recipient: {
      recipientName: "Demo Supplier",
      phoneE164: fictionalPhone,
      maskedPhone: "+1 ***-***-2222",
      region: "US",
      locale: "en-US",
    },
    schemaValidation: "not_run",
    consistencyValidation: "not_run",
    artifactState: "none",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:01:00.000Z",
    ...overrides,
  };
}

describe("transitionRun", () => {
  it.each<[RunStatus, RunStatus]>([
    ["DRAFT", "AWAITING_APPROVAL"],
    ["AWAITING_APPROVAL", "CALL_STARTING"],
    ["CALL_STARTING", "CALL_IN_PROGRESS"],
    ["CALL_STARTING", "RECONCILING"],
    ["CALL_STARTING", "FAILED"],
    ["CALL_IN_PROGRESS", "RECONCILING"],
    ["CALL_IN_PROGRESS", "PROVIDER_REPORTED_TERMINAL"],
    ["CALL_IN_PROGRESS", "FAILED"],
    ["RECONCILING", "CALL_STARTING"],
    ["RECONCILING", "CALL_IN_PROGRESS"],
    ["RECONCILING", "PROVIDER_REPORTED_TERMINAL"],
    ["RECONCILING", "OUTCOME_UNKNOWN"],
    ["RECONCILING", "FAILED"],
    ["PROVIDER_REPORTED_TERMINAL", "OUTCOME_UNKNOWN"],
    ["PROVIDER_REPORTED_TERMINAL", "FAILED"],
  ])("allows %s to %s", (status, next) => {
    expect(transitionRun(createRun({ status }), next).status).toBe(next);
  });

  it.each<RunStatus>([
    "DRAFT",
    "AWAITING_APPROVAL",
    "CALL_STARTING",
    "CALL_IN_PROGRESS",
    "RECONCILING",
    "PROVIDER_REPORTED_TERMINAL",
    "COMPLETED",
    "OUTCOME_UNKNOWN",
    "FAILED",
  ])("forbids the %s self-transition", (status) => {
    expect(() => transitionRun(createRun({ status }), status)).toThrowError(
      "RUN_TRANSITION_FORBIDDEN",
    );
  });

  it.each<[RunStatus, RunStatus]>([
    ["DRAFT", "CALL_STARTING"],
    ["AWAITING_APPROVAL", "CALL_IN_PROGRESS"],
    ["CALL_STARTING", "PROVIDER_REPORTED_TERMINAL"],
    ["CALL_IN_PROGRESS", "COMPLETED"],
    ["RECONCILING", "COMPLETED"],
    ["COMPLETED", "FAILED"],
    ["OUTCOME_UNKNOWN", "FAILED"],
    ["FAILED", "DRAFT"],
  ])("forbids %s to %s", (status, next) => {
    expect(() => transitionRun(createRun({ status }), next)).toThrowError(
      "RUN_TRANSITION_FORBIDDEN",
    );
  });

  it("allows completion only after the completion predicate passes", () => {
    const readyForCompletion = createRun({
      status: "PROVIDER_REPORTED_TERMINAL",
      schemaValidation: "passed",
      consistencyValidation: "passed",
      trustStatus: "HUMAN_CONFIRMED",
      artifactState: "ready",
    });

    expect(transitionRun(readyForCompletion, "COMPLETED").status).toBe(
      "COMPLETED",
    );
    expect(() =>
      transitionRun(
        createRun({ status: "PROVIDER_REPORTED_TERMINAL" }),
        "COMPLETED",
      ),
    ).toThrowError("RUN_TRANSITION_FORBIDDEN");
  });

  it("preserves unrelated fields without mutating or timestamp invention", () => {
    const run = createRun({ callId: "provider-call-001" });
    const before = structuredClone(run);

    expect(transitionRun(run, "AWAITING_APPROVAL")).toEqual({
      ...before,
      status: "AWAITING_APPROVAL",
      version: 4,
    });
    expect(run).toEqual(before);
  });

  it("exposes only the bounded transition error code", () => {
    try {
      transitionRun(createRun(), "CALL_STARTING");
      throw new Error("Expected transitionRun to throw");
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: "RUN_TRANSITION_FORBIDDEN",
        message: "RUN_TRANSITION_FORBIDDEN",
      });
    }
  });
});

describe("runRecordSchema", () => {
  it("rejects unknown keys and bounded-field violations", () => {
    expect(
      runRecordSchema.safeParse({ ...createRun(), unexpected: true }),
    ).toMatchObject({ success: false });
    expect(
      runRecordSchema.safeParse({ ...createRun(), id: "x".repeat(129) }),
    ).toMatchObject({ success: false });
  });

  it("rejects untrusted provider evidence that is malformed, unknown, or unbounded", () => {
    const snapshot = {
      callId: "provider-call-001",
      status: "completed",
      observedAt: "2026-08-08T12:00:30.000Z",
      taskCompleted: true,
      completionConfidence: { score: 1, label: "certain" },
      transcript: [{ speaker: "user", text: "Complete" }],
      structuredResult: { complete: true },
      evidence: [{ id: "evidence-001", excerpt: "Complete", turnIndexes: [0] }],
    };

    expect(
      runRecordSchema.safeParse({
        ...createRun(),
        providerSnapshot: { ...snapshot, unexpected: true },
      }),
    ).toMatchObject({ success: false });
    expect(
      runRecordSchema.safeParse({
        ...createRun(),
        providerSnapshot: {
          ...snapshot,
          completionConfidence: {
            score: Number.POSITIVE_INFINITY,
            label: "certain",
          },
        },
      }),
    ).toMatchObject({ success: false });
    expect(
      runRecordSchema.safeParse({
        ...createRun(),
        providerSnapshot: {
          ...snapshot,
          transcript: Array.from({ length: 10_000 }, () => ({
            speaker: "user",
            text: "Complete",
          })),
        },
      }),
    ).toMatchObject({ success: false });
  });
});
