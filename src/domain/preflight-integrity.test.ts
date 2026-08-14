import { describe, expect, it } from "vitest";

import { AppError } from "./errors.js";
import { validatePreflightEvidenceIntegrity } from "./preflight-integrity.js";
import type { ProviderEvidenceSnapshot } from "./run.js";

const answeredSnapshot: ProviderEvidenceSnapshot = {
  callId: "call_demo_integrity_001",
  status: "completed",
  observedAt: "2026-08-14T10:00:00.000Z",
  taskCompleted: true,
  completionConfidence: { score: 0.98, label: "high" },
  transcript: [
    { speaker: "bot", text: "How many fictional units are ready now?" },
    {
      speaker: "user",
      text: "Three hundred fifty are ready and one hundred fifty are delayed.",
    },
  ],
  structuredResult: {
    contactOutcome: "reached",
    confirmedQuantity: 500,
    availableQuantity: 350,
    delayedQuantity: 150,
    promisedDeliveryDate: "2026-08-22",
    delayReason: "Component shortage",
    followUpRequired: "yes",
    unableToFulfill: "no",
  },
  evidence: [],
};

const declinedSnapshot: ProviderEvidenceSnapshot = {
  callId: "call_demo_integrity_002",
  status: "completed",
  observedAt: "2026-08-14T10:05:00.000Z",
  taskCompleted: true,
  completionConfidence: { score: 0.95, label: "high" },
  transcript: [{ speaker: "user", text: "I decline to continue." }],
  structuredResult: {
    contactOutcome: "declined",
    confirmedQuantity: 0,
    availableQuantity: 0,
    delayedQuantity: 0,
    promisedDeliveryDate: "unknown",
    delayReason: "unknown",
    followUpRequired: "no",
    unableToFulfill: "unknown",
  },
  evidence: [],
};

const noAnswerSnapshot: ProviderEvidenceSnapshot = {
  callId: "call_demo_integrity_003",
  status: "completed",
  observedAt: "2026-08-14T10:10:00.000Z",
  taskCompleted: false,
  completionConfidence: null,
  transcript: [],
  structuredResult: {
    contactOutcome: "no_answer",
    confirmedQuantity: 0,
    availableQuantity: 0,
    delayedQuantity: 0,
    promisedDeliveryDate: "unknown",
    delayReason: "unknown",
    followUpRequired: "unknown",
    unableToFulfill: "unknown",
  },
  evidence: [],
};

function expectProviderResultInvalid(
  scenario: "answered" | "declined" | "no_answer",
  input: unknown,
): AppError {
  let thrown: unknown;
  try {
    validatePreflightEvidenceIntegrity(scenario, input);
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AppError);
  expect(thrown).toMatchObject({
    name: "AppError",
    message: "PROVIDER_RESULT_INVALID",
    code: "PROVIDER_RESULT_INVALID",
  });
  return thrown as AppError;
}

describe("validatePreflightEvidenceIntegrity", () => {
  it("accepts answered evidence with reconciled quantities and a user turn", () => {
    const result = validatePreflightEvidenceIntegrity(
      "answered",
      answeredSnapshot,
    );

    expect(result).toMatchObject({
      snapshot: { status: "completed" },
      response: {
        contactOutcome: "reached",
        confirmedQuantity: 500,
        availableQuantity: 350,
        delayedQuantity: 150,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects recovered evidence with inconsistent quantities", () => {
    const recoveredInconsistent = {
      ...answeredSnapshot,
      structuredResult: {
        ...(answeredSnapshot.structuredResult as Record<string, unknown>),
        availableQuantity: 17,
        delayedQuantity: 5,
      },
    };

    expectProviderResultInvalid("answered", recoveredInconsistent);
  });

  it("rejects a reached result without a non-empty user turn", () => {
    const reachedWithoutUserTurn = {
      ...answeredSnapshot,
      transcript: [{ speaker: "bot", text: "Please confirm the quantities." }],
    };

    expectProviderResultInvalid("answered", reachedWithoutUserTurn);
  });

  it("rejects a completed snapshot without a structured result", () => {
    const completedWithoutResult = {
      ...answeredSnapshot,
      structuredResult: null,
    };

    expectProviderResultInvalid("answered", completedWithoutResult);
  });

  it("accepts truthful declined evidence with an explicit refusal", () => {
    expect(
      validatePreflightEvidenceIntegrity("declined", declinedSnapshot),
    ).toMatchObject({
      response: {
        contactOutcome: "declined",
        confirmedQuantity: 0,
        followUpRequired: "no",
      },
    });
  });

  it("accepts the truthful no-answer sentinel", () => {
    expect(
      validatePreflightEvidenceIntegrity("no_answer", noAnswerSnapshot),
    ).toMatchObject({
      snapshot: {
        taskCompleted: false,
        completionConfidence: null,
        transcript: [],
        evidence: [],
      },
      response: {
        contactOutcome: "no_answer",
        promisedDeliveryDate: "unknown",
        delayReason: "unknown",
        followUpRequired: "unknown",
        unableToFulfill: "unknown",
      },
    });
  });

  it.each([
    ["answered", declinedSnapshot],
    ["declined", answeredSnapshot],
    ["no_answer", answeredSnapshot],
  ] as const)(
    "rejects a %s scenario/outcome mismatch",
    (scenario, snapshot) => {
      expectProviderResultInvalid(scenario, snapshot);
    },
  );

  it("rejects a non-terminal provider status", () => {
    expectProviderResultInvalid("answered", {
      ...answeredSnapshot,
      status: "in_progress",
    });
  });

  it.each([
    {
      name: "nonzero quantities",
      snapshot: {
        ...noAnswerSnapshot,
        structuredResult: {
          ...(noAnswerSnapshot.structuredResult as Record<string, unknown>),
          confirmedQuantity: 1,
          availableQuantity: 1,
        },
      },
    },
    {
      name: "a promised delivery date",
      snapshot: {
        ...noAnswerSnapshot,
        structuredResult: {
          ...(noAnswerSnapshot.structuredResult as Record<string, unknown>),
          promisedDeliveryDate: "2026-08-22",
        },
      },
    },
    {
      name: "a delay reason",
      snapshot: {
        ...noAnswerSnapshot,
        structuredResult: {
          ...(noAnswerSnapshot.structuredResult as Record<string, unknown>),
          delayReason: "Known reason",
        },
      },
    },
    {
      name: "a follow-up decision",
      snapshot: {
        ...noAnswerSnapshot,
        structuredResult: {
          ...(noAnswerSnapshot.structuredResult as Record<string, unknown>),
          followUpRequired: "no",
        },
      },
    },
    {
      name: "a fulfillment decision",
      snapshot: {
        ...noAnswerSnapshot,
        structuredResult: {
          ...(noAnswerSnapshot.structuredResult as Record<string, unknown>),
          unableToFulfill: "no",
        },
      },
    },
    {
      name: "completed-task metadata",
      snapshot: { ...noAnswerSnapshot, taskCompleted: true },
    },
    {
      name: "completion confidence",
      snapshot: {
        ...noAnswerSnapshot,
        completionConfidence: { score: 0.5, label: "medium" },
      },
    },
    {
      name: "a transcript turn",
      snapshot: {
        ...noAnswerSnapshot,
        transcript: [{ speaker: "bot", text: "No response." }],
      },
    },
    {
      name: "an evidence excerpt",
      snapshot: {
        ...noAnswerSnapshot,
        evidence: [
          { id: "evidence_001", excerpt: "No response", turnIndexes: [] },
        ],
      },
    },
  ])("rejects no-answer evidence containing $name", ({ snapshot }) => {
    expectProviderResultInvalid("no_answer", snapshot);
  });

  it("rejects extra root and nested properties", () => {
    expectProviderResultInvalid("answered", {
      ...answeredSnapshot,
      unexpectedRoot: true,
    });
    expectProviderResultInvalid("answered", {
      ...answeredSnapshot,
      structuredResult: {
        ...(answeredSnapshot.structuredResult as Record<string, unknown>),
        unexpectedNested: true,
      },
    });
  });

  it("rejects a custom prototype", () => {
    const input = Object.assign(Object.create({ inherited: "unsafe" }), {
      ...answeredSnapshot,
    });

    expectProviderResultInvalid("answered", input);
  });

  it("rejects a root accessor without invoking it", () => {
    let getterCalls = 0;
    const input = { ...answeredSnapshot };
    Object.defineProperty(input, "status", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "completed";
      },
    });

    expectProviderResultInvalid("answered", input);
    expect(getterCalls).toBe(0);
  });

  it("rejects a nested-object accessor without invoking it", () => {
    let getterCalls = 0;
    const structuredResult = {
      ...(answeredSnapshot.structuredResult as Record<string, unknown>),
    };
    Object.defineProperty(structuredResult, "availableQuantity", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 350;
      },
    });

    expectProviderResultInvalid("answered", {
      ...answeredSnapshot,
      structuredResult,
    });
    expect(getterCalls).toBe(0);
  });

  it("rejects an array accessor without invoking it", () => {
    let getterCalls = 0;
    const transcript = [...answeredSnapshot.transcript];
    Object.defineProperty(transcript, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return answeredSnapshot.transcript[0];
      },
    });

    expectProviderResultInvalid("answered", {
      ...answeredSnapshot,
      transcript,
    });
    expect(getterCalls).toBe(0);
  });

  it("returns only the bounded public failure projection", () => {
    const marker = "RAW_INVALID_PROVIDER_MARKER";
    const error = expectProviderResultInvalid("answered", {
      ...answeredSnapshot,
      [marker]: marker,
    });
    const publicProjection = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
    });

    expect(error.name).not.toContain(marker);
    expect(error.message).not.toContain(marker);
    expect(error.code).not.toContain(marker);
    expect(publicProjection).not.toContain(marker);
  });
});
