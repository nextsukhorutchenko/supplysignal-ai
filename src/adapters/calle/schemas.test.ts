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

describe("CALL-E OpenAPI 0.6.0 response schemas", () => {
  it.each([
    "create-accepted.json",
    "in-progress.json",
    "completed-valid.json",
    "completed-missing-result.json",
    "failed.json",
    "unknown-status.json",
  ])("accepts the reviewed %s fixture shape", async (name) => {
    expect(callResourceSchema.safeParse(await fixture(name)).success).toBe(
      true,
    );
  });

  it("accepts the reviewed events page fixture shape", async () => {
    expect(
      eventsPageSchema.safeParse(await fixture("events-page.json")).success,
    ).toBe(true);
  });

  it("uses a bounded raw response cap before parsing", () => {
    expect(MAX_CALLE_RESPONSE_BYTES).toBe(1_048_576);
  });

  it.each([
    ["call resource", callResourceSchema, "completed-valid.json"],
    ["events page", eventsPageSchema, "events-page.json"],
  ] as const)(
    "rejects unknown %s properties",
    async (_name, schema, fixtureName) => {
      expect(
        schema.safeParse({
          ...((await fixture(fixtureName)) as object),
          unexpected_provider_field: true,
        }).success,
      ).toBe(false);
    },
  );

  it("rejects malformed timestamps", async () => {
    expect(
      callResourceSchema.safeParse({
        ...((await fixture("completed-valid.json")) as object),
        updated_at: "2026-02-30T12:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("rejects identifier normalization and unsafe external controls", async () => {
    const valid = (await fixture("completed-valid.json")) as Record<
      string,
      unknown
    >;

    expect(
      callResourceSchema.safeParse({ ...valid, call_id: " call_demo_001 " })
        .success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({ ...valid, call_id: "call_demo\n001" })
        .success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        transcript: [{ speaker: "user", text: "unsafe\u001b[31mred" }],
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipient_result: {
          ...(valid.recipient_result as object),
          delay_reason: "unsafe\u001b[31mred",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects transcript and evidence values beyond the provider bounds", async () => {
    const valid = (await fixture("completed-valid.json")) as Record<
      string,
      unknown
    >;
    const turn = { speaker: "user", text: "bounded" };
    const evidence = {
      id: "evidence_001",
      excerpt: "bounded",
      turn_indexes: [0],
    };

    expect(
      callResourceSchema.safeParse({
        ...valid,
        transcript: Array.from({ length: 501 }, () => turn),
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        evidence: Array.from({ length: 51 }, () => evidence),
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        transcript: [{ speaker: "user", text: "x".repeat(4_001) }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown structured-result properties and nullable field values", async () => {
    const valid = (await fixture("completed-valid.json")) as Record<
      string,
      unknown
    >;
    const recipientResult = valid.recipient_result as object;

    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipient_result: { ...recipientResult, provider_extra: true },
      }).success,
    ).toBe(false);
    expect(
      callResourceSchema.safeParse({
        ...valid,
        recipient_result: {
          ...recipientResult,
          promised_delivery_date: null,
        },
      }).success,
    ).toBe(false);
  });
});
