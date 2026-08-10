import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { AppError } from "../../domain/errors.js";
import { mapCallResource, mapEventsPage } from "./mapper.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../../../tests/fixtures/calle/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

describe("mapCallResource", () => {
  it.each([
    ["create-accepted.json", "queued"],
    ["in-progress.json", "in_progress"],
    ["completed-valid.json", "completed"],
    ["failed.json", "failed"],
  ] as const)(
    "maps %s to the bounded %s domain status",
    async (name, status) => {
      expect(mapCallResource(await fixture(name)).status).toBe(status);
    },
  );

  it("maps canceled without treating the call as successful", async () => {
    const failed = (await fixture("failed.json")) as Record<string, unknown>;

    expect(mapCallResource({ ...failed, status: "canceled" })).toMatchObject({
      status: "canceled",
      taskCompleted: false,
      transcript: [],
      structuredResult: null,
    });
  });

  it("fails closed to unknown for a future provider status", async () => {
    expect(mapCallResource(await fixture("unknown-status.json"))).toMatchObject(
      {
        callId: "call_demo_004",
        status: "unknown",
      },
    );
  });

  it("maps the completed supplier result and evidence to domain names", async () => {
    expect(mapCallResource(await fixture("completed-valid.json"))).toEqual({
      callId: "call_demo_001",
      status: "completed",
      observedAt: "2026-08-09T12:02:00.000Z",
      taskCompleted: true,
      completionConfidence: { score: 0.98, label: "high" },
      transcript: [
        {
          speaker: "bot",
          text: "How many fictional units are ready now?",
        },
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
      evidence: [
        {
          id: "evidence_001",
          excerpt:
            "Three hundred fifty are ready and one hundred fifty are delayed.",
          turnIndexes: [],
        },
      ],
    });
  });

  it("rejects a terminal resource with a null structured result", async () => {
    const resource = await fixture("completed-missing-result.json");

    expect(() => mapCallResource(resource)).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_RESULT_INVALID",
        message: "PROVIDER_RESULT_INVALID",
      }),
    );
  });

  it("retains an empty nested transcript without inventing turns", async () => {
    const completed = (await fixture("completed-valid.json")) as Record<
      string,
      unknown
    >;
    const completedRecipient = (
      completed.recipients as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    const completedAttempt = (
      completedRecipient.attempts as Record<string, unknown>[]
    )[0] as Record<string, unknown>;

    expect(
      mapCallResource({
        ...completed,
        recipients: [
          {
            ...completedRecipient,
            attempts: [{ ...completedAttempt, transcript_turns: [] }],
          },
        ],
      }).transcript,
    ).toEqual([]);
  });

  it("does not let provider-sized values exceed the stricter domain boundary", async () => {
    const completed = (await fixture("completed-valid.json")) as Record<
      string,
      unknown
    >;
    const completedRecipient = (
      completed.recipients as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    const completedAttempt = (
      completedRecipient.attempts as Record<string, unknown>[]
    )[0] as Record<string, unknown>;

    expect(() =>
      mapCallResource({
        ...completed,
        recipients: [
          {
            ...completedRecipient,
            attempts: [
              {
                ...completedAttempt,
                transcript_turns: Array.from({ length: 121 }, () => ({
                  offset_seconds: 0,
                  speaker: "user",
                  text: "bounded",
                })),
              },
            ],
          },
        ],
      }),
    ).toThrow("PROVIDER_RESULT_INVALID");
    expect(() =>
      mapCallResource({
        ...completed,
        recipients: [
          {
            ...completedRecipient,
            structured_result: {
              ...(completedRecipient.structured_result as object),
              delay_reason: "x".repeat(501),
            },
          },
        ],
      }),
    ).toThrow("PROVIDER_RESULT_INVALID");
  });

  it("preserves only truthful no-answer sentinels and no transcript", async () => {
    const completed = (await fixture("completed-valid.json")) as Record<
      string,
      unknown
    >;
    const completedRecipient = (
      completed.recipients as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    const snapshot = mapCallResource({
      ...completed,
      task_completed: false,
      completion_confidence: null,
      evidence: [],
      recipients: [
        {
          ...completedRecipient,
          attempts: [],
          structured_result: {
            contact_outcome: "no_answer",
            confirmed_quantity: 0,
            available_quantity: 0,
            delayed_quantity: 0,
            promised_delivery_date: "unknown",
            delay_reason: "unknown",
            follow_up_required: "unknown",
            unable_to_fulfill: "unknown",
          },
        },
      ],
    });

    expect(snapshot).toMatchObject({
      taskCompleted: false,
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
    });
  });

  it("returns only a bounded typed error for malformed provider data", () => {
    const fullPhone = ["+1", "202", "555", "0123"].join("");
    const providerMessage = `${fullPhone} C:\\private\\provider raw transcript`;

    try {
      mapCallResource({
        id: "call_demo_unsafe",
        status: "completed",
        provider_message: providerMessage,
      });
      throw new Error("Expected mapping to reject");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "PROVIDER_RESULT_INVALID",
        message: "PROVIDER_RESULT_INVALID",
      });
      const exposed = `${String(error)} ${JSON.stringify(error)}`;
      expect(exposed).not.toContain(fullPhone);
      expect(exposed).not.toContain("C:\\private\\provider");
      expect(exposed).not.toContain("raw transcript");
    }
  });
});

describe("mapEventsPage", () => {
  it("maps only the bounded informational timeline", async () => {
    expect(mapEventsPage(await fixture("events-page.json"))).toEqual({
      events: [
        {
          id: "event_001",
          type: "call.queued",
          occurredAt: "2026-08-09T12:00:00.000Z",
          summary: "Call queued",
        },
        {
          id: "event_002",
          type: "call.in_progress",
          occurredAt: "2026-08-09T12:00:05.000Z",
          summary: "Call in progress",
        },
      ],
      nextCursor: null,
    });
  });
});
