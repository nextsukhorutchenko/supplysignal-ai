import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  callResourceSchema,
  eventsPageSchema,
  MAX_CALLE_RESPONSE_BYTES,
} from "./schemas.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../../../tests/fixtures/calle/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function recipient(resource: Record<string, unknown>): Record<string, unknown> {
  return (resource.recipients as Record<string, unknown>[])[0] ?? {};
}

function attempt(resource: Record<string, unknown>): Record<string, unknown> {
  return (recipient(resource).attempts as Record<string, unknown>[])[0] ?? {};
}

function without(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([entryKey]) => entryKey !== key),
  );
}

describe("CALL-E OpenAPI 0.6.0 response schemas", () => {
  it.each([
    "create-accepted.json",
    "in-progress.json",
    "completed-valid.json",
    "completed-missing-result.json",
    "failed.json",
    "unknown-status.json",
  ])("accepts the reviewed official CallTask shape in %s", async (name) => {
    expect(callResourceSchema.safeParse(await fixture(name)).success).toBe(
      true,
    );
  });

  it("accepts the reviewed official EventList shape", async () => {
    expect(
      eventsPageSchema.safeParse(await fixture("events-page.json")).success,
    ).toBe(true);
  });

  it("uses a bounded raw response cap before parsing", () => {
    expect(MAX_CALLE_RESPONSE_BYTES).toBe(1_048_576);
  });

  it.each([
    ["CallTask", callResourceSchema, "completed-valid.json"],
    ["EventList", eventsPageSchema, "events-page.json"],
  ] as const)("rejects unknown %s properties", async (_name, schema, name) => {
    expect(
      schema.safeParse({
        ...record(await fixture(name)),
        unexpected_provider_field: true,
      }).success,
    ).toBe(false);
  });

  it("requires every official CallTask, recipient, attempt, and event field", async () => {
    const valid = record(await fixture("completed-valid.json"));
    const validRecipient = recipient(valid);
    const validAttempt = attempt(valid);
    const events = record(await fixture("events-page.json"));
    const firstEvent = (events.data as Record<string, unknown>[])[0] ?? {};

    const withoutTask = without(valid, "task");
    const withoutAttempts = without(validRecipient, "attempts");
    const withoutTurns = without(validAttempt, "transcript_turns");
    const withoutDetails = without(firstEvent, "details");

    expect(callResourceSchema.safeParse(withoutTask).success).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipients: [{ ...withoutAttempts }],
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipients: [{ ...validRecipient, attempts: [{ ...withoutTurns }] }],
      }).success,
    ).toBe(false);
    expect(
      eventsPageSchema.safeParse({ ...events, data: [{ ...withoutDetails }] })
        .success,
    ).toBe(false);
  });

  it("rejects malformed timestamps", async () => {
    expect(
      callResourceSchema.safeParse({
        ...record(await fixture("completed-valid.json")),
        completed_at: "2026-02-30T12:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("enforces exact call identifiers and encode-safe identifiers and cursors", async () => {
    const valid = record(await fixture("completed-valid.json"));
    const events = record(await fixture("events-page.json"));

    for (const id of [
      "demo_001",
      " call_demo_001 ",
      "call_demo/001",
      "call_\ud800",
    ]) {
      expect(callResourceSchema.safeParse({ ...valid, id }).success).toBe(
        false,
      );
    }
    expect(
      eventsPageSchema.safeParse({ ...events, next_cursor: "cursor_\ud800" })
        .success,
    ).toBe(false);
  });

  it("rejects transcript and evidence values beyond provider bounds", async () => {
    const valid = record(await fixture("completed-valid.json"));
    const validRecipient = recipient(valid);
    const validAttempt = attempt(valid);
    const turn = { offset_seconds: 0, speaker: "user", text: "bounded" };

    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipients: [
          {
            ...validRecipient,
            attempts: [
              {
                ...validAttempt,
                transcript_turns: Array.from({ length: 501 }, () => turn),
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        evidence: Array.from({ length: 51 }, () => "bounded"),
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipients: [
          {
            ...validRecipient,
            attempts: [
              {
                ...validAttempt,
                transcript_turns: [{ ...turn, text: "x".repeat(4_001) }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown structured-result properties and nullable business fields", async () => {
    const valid = record(await fixture("completed-valid.json"));
    const validRecipient = recipient(valid);
    const result = validRecipient.structured_result as object;

    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipients: [
          {
            ...validRecipient,
            structured_result: { ...result, provider_extra: true },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipients: [
          {
            ...validRecipient,
            structured_result: {
              ...result,
              promised_delivery_date: null,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only a truthful no-answer snapshot", async () => {
    const valid = record(await fixture("completed-valid.json"));
    const validRecipient = recipient(valid);
    const truthfulResult = {
      contact_outcome: "no_answer",
      confirmed_quantity: 0,
      available_quantity: 0,
      delayed_quantity: 0,
      promised_delivery_date: "unknown",
      delay_reason: "unknown",
      follow_up_required: "unknown",
      unable_to_fulfill: "unknown",
    };
    const truthful = {
      ...valid,
      task_completed: false,
      completion_confidence: null,
      evidence: [],
      recipients: [
        {
          ...validRecipient,
          structured_result: truthfulResult,
          attempts: [],
        },
      ],
    };

    expect(callResourceSchema.safeParse(truthful).success).toBe(true);
    expect(
      callResourceSchema.safeParse({ ...truthful, task_completed: true })
        .success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...truthful,
        recipients: [
          {
            ...recipient(truthful),
            structured_result: {
              ...truthfulResult,
              confirmed_quantity: 1,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...truthful,
        recipients: [
          {
            ...recipient(truthful),
            attempts: [attempt(valid)],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
