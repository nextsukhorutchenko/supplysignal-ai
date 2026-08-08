import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Clock } from "../../src/application/ports.js";
import { FileRunStore } from "../../src/adapters/filesystem/run-store.js";
import type { RunRecord } from "../../src/domain/run.js";

const clock: Clock = {
  now: () => "2026-08-08T12:00:00.000Z",
  sleep: async () => undefined,
};

function createRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-concurrency",
    version: 0,
    status: "DRAFT",
    trustStatus: "UNVERIFIED_PROVIDER_RESULT",
    order: {
      supplierName: "Northstar Components",
      purchaseOrderRef: "PO-2048",
      expectedQuantity: 500,
      requiredDeliveryDate: "2026-08-15",
    },
    recipient: {
      recipientName: "Consenting participant",
      phoneE164: "+12025550123",
      maskedPhone: "+1 ***-***-0123",
      region: "US",
      locale: "en-US",
    },
    schemaValidation: "not_run",
    consistencyValidation: "not_run",
    artifactState: "none",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z",
    ...overrides,
  };
}

const roots: string[] = [];

async function createStore(): Promise<{ root: string; store: FileRunStore }> {
  const root = await mkdtemp(join(tmpdir(), "supplysignal-run-race-"));
  roots.push(root);
  return { root, store: new FileRunStore({ root, clock }) };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileRunStore concurrency", () => {
  it("allows exactly one concurrent create for one run id", async () => {
    const { root, store } = await createStore();

    const results = await Promise.allSettled([
      store.create(createRun()),
      store.create(createRun()),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await store.read("run-concurrency")).version).toBe(0);
    expect(await readdir(root)).toEqual(["run-concurrency.json"]);
  });

  it("allows exactly one concurrent compare-and-swap winner", async () => {
    const { root, store } = await createStore();
    await store.create(createRun());
    const claimA = createRun({
      version: 1,
      status: "CALL_STARTING",
      idempotencyKey: "run-concurrency:a",
    });
    const claimB = createRun({
      version: 1,
      status: "CALL_STARTING",
      idempotencyKey: "run-concurrency:b",
    });

    const results = await Promise.allSettled([
      store.compareAndSwap("run-concurrency", 0, claimA),
      store.compareAndSwap("run-concurrency", 0, claimB),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const stored = await store.read("run-concurrency");
    expect(stored.version).toBe(1);
    expect(["run-concurrency:a", "run-concurrency:b"]).toContain(
      stored.idempotencyKey,
    );
    expect(await readdir(root)).toEqual(["run-concurrency.json"]);
  });
});
