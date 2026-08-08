import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileRunStore } from "../../src/adapters/filesystem/run-store.js";
import type { Clock } from "../../src/application/ports.js";
import type { RunRecord } from "../../src/domain/run.js";

const clock: Clock = {
  now: () => "2026-08-08T12:00:00.000Z",
  sleep: async () => undefined,
};

function createRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
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

async function createStores(): Promise<{
  root: string;
  first: FileRunStore;
  second: FileRunStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "supplysignal-run-race-"));
  roots.push(root);
  return {
    root,
    first: new FileRunStore({ root, clock }),
    second: new FileRunStore({ root, clock }),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileRunStore immutable concurrency", () => {
  it("allows exactly one concurrent create for version zero", async () => {
    const { root, first, second } = await createStores();
    const id = "run-concurrency";

    const results = await Promise.allSettled([
      first.create(createRun(id)),
      second.create(createRun(id)),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await first.read(id)).version).toBe(0);
    expect(await readdir(root)).toEqual([
      "run-concurrency.v0000000000000000.json",
    ]);
  });

  it("allows exactly one concurrent compare-and-swap winner", async () => {
    const { root, first, second } = await createStores();
    const id = "run-concurrency";
    await first.create(createRun(id));
    const claimA = createRun(id, {
      version: 1,
      status: "CALL_STARTING",
      idempotencyKey: "run-concurrency:a",
    });
    const claimB = createRun(id, {
      version: 1,
      status: "CALL_STARTING",
      idempotencyKey: "run-concurrency:b",
    });

    const results = await Promise.allSettled([
      first.compareAndSwap(id, 0, claimA),
      second.compareAndSwap(id, 0, claimB),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const stored = await first.read(id);
    expect(stored.version).toBe(1);
    expect(["run-concurrency:a", "run-concurrency:b"]).toContain(
      stored.idempotencyKey,
    );
    expect((await readdir(root)).sort()).toEqual([
      "run-concurrency.v0000000000000000.json",
      "run-concurrency.v0000000000000001.json",
    ]);
  });

  it("produces zero dual winners across 200 formerly stale-lock races", async () => {
    const { root, first, second } = await createStores();
    let dualWinners = 0;

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const id = `race-${String(iteration).padStart(3, "0")}`;
      await first.create(createRun(id));
      const results = await Promise.allSettled([
        first.compareAndSwap(
          id,
          0,
          createRun(id, {
            version: 1,
            status: "CALL_STARTING",
            idempotencyKey: `${id}:a`,
          }),
        ),
        second.compareAndSwap(
          id,
          0,
          createRun(id, {
            version: 1,
            status: "CALL_STARTING",
            idempotencyKey: `${id}:b`,
          }),
        ),
      ]);
      const winners = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      if (winners === 2) {
        dualWinners += 1;
      }
      expect(winners).toBe(1);
    }

    expect(dualWinners).toBe(0);
    expect((await readdir(root)).some((name) => name.endsWith(".lock"))).toBe(
      false,
    );
  }, 30_000);
});
