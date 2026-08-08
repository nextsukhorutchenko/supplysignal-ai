import { lstat, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Clock } from "../../application/ports.js";
import type { RunRecord } from "../../domain/run.js";
import { FileRunStore } from "./run-store.js";

const fixedNow = "2026-08-08T12:00:00.000Z";
const privatePhone = "+12025550123";

class MutableClock implements Clock {
  constructor(private current = fixedNow) {}

  now(): string {
    return this.current;
  }

  set(value: string): void {
    this.current = value;
  }

  async sleep(): Promise<void> {}
}

function createRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
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
      phoneE164: privatePhone,
      maskedPhone: "+1 ***-***-0123",
      region: "US",
      locale: "en-US",
    },
    schemaValidation: "not_run",
    consistencyValidation: "not_run",
    artifactState: "none",
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supplysignal-run-store-"));
  roots.push(root);
  return root;
}

async function expectBoundedFailure(
  promise: Promise<unknown>,
  expectedCode: string,
  root: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected run-store operation to reject");
  } catch (error: unknown) {
    expect(error).toMatchObject({ message: expectedCode });
    const exposed = `${String(error)} ${JSON.stringify(error)}`;
    expect(exposed).not.toContain(privatePhone);
    expect(exposed).not.toContain(root);
  }
}

async function auxiliaryFiles(root: string): Promise<string[]> {
  return (await readdir(root)).filter(
    (name) => name.endsWith(".tmp") || name.endsWith(".lock"),
  );
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileRunStore", () => {
  it("creates and reads a strictly validated detached record", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    const run = createRun();

    await store.create(run);
    run.order.supplierName = "Mutated caller value";

    const stored = await store.read("run-001");
    expect(stored.order.supplierName).toBe("Northstar Components");
    expect(stored).not.toBe(run);
    expect(stored.order).not.toBe(run.order);
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it.each([
    "",
    ".",
    "..",
    "../escape",
    "run/escape",
    "run\\escape",
    "/absolute",
    "C:\\absolute",
    "UPPERCASE",
    "-leading",
    `r${"x".repeat(64)}`,
  ])("rejects invalid run id %j before deriving a path", async (runId) => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    const outside = `${root}-escape.json`;
    await writeFile(outside, "outside", "utf8");

    await expectBoundedFailure(store.read(runId), "RUN_STORE_INVALID_ID", root);
    expect(await readdir(root)).toEqual([]);
    expect(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(outside, "utf8"),
      ),
    ).toBe("outside");
    await import("node:fs/promises").then(({ rm }) => rm(outside));
  });

  it("stores a grammar-valid device-like id as a regular confined file", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });

    await store.create(createRun({ id: "con" }));

    expect((await store.read("con")).id).toBe("con");
    const files = await readdir(root);
    expect(files).toHaveLength(1);
    expect((await lstat(join(root, files[0] ?? "missing"))).isFile()).toBe(
      true,
    );
  });

  it("never overwrites an existing run", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    await store.create(createRun());

    await expectBoundedFailure(
      store.create(
        createRun({
          order: {
            ...createRun().order,
            supplierName: "Replacement supplier",
          },
        }),
      ),
      "RUN_STORE_ALREADY_EXISTS",
      root,
    );

    expect((await store.read("run-001")).order.supplierName).toBe(
      "Northstar Components",
    );
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it("rejects schema-invalid records before writing", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });

    await expectBoundedFailure(
      store.create(createRun({ status: "INVALID" as RunRecord["status"] })),
      "RUN_STORE_INVALID_RECORD",
      root,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects an accessor-backed record without reading its run id", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    const run = createRun();
    let getterCalls = 0;
    Object.defineProperty(run, "id", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "run-001";
      },
    });

    await expectBoundedFailure(
      store.create(run),
      "RUN_STORE_INVALID_RECORD",
      root,
    );
    expect(getterCalls).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it("bounds malformed and schema-invalid stored data without exposing it", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    await writeFile(join(root, "run-001.json"), `{${privatePhone}`, "utf8");

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );

    await writeFile(
      join(root, "run-001.json"),
      JSON.stringify({ ...createRun(), unexpected: privatePhone }),
      "utf8",
    );
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("rejects oversized stored data before JSON parsing", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    await writeFile(join(root, "run-001.json"), "x".repeat(1_048_577), "utf8");

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("rejects stale versions, id mismatches, and next-version mismatches", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    await store.create(createRun());

    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        1,
        createRun({ version: 2, status: "AWAITING_APPROVAL" }),
      ),
      "RUN_STORE_CONFLICT",
      root,
    );
    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        0,
        createRun({ id: "run-002", version: 1 }),
      ),
      "RUN_STORE_CONFLICT",
      root,
    );
    await expectBoundedFailure(
      store.compareAndSwap("run-001", 0, createRun({ version: 2 })),
      "RUN_STORE_CONFLICT",
      root,
    );
    expect((await store.read("run-001")).version).toBe(0);
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it("atomically replaces a matching version and returns a detached record", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    await store.create(createRun());
    const next = createRun({ version: 1, status: "AWAITING_APPROVAL" });

    const result = await store.compareAndSwap("run-001", 0, next);
    next.order.supplierName = "Mutated next value";
    result.order.purchaseOrderRef = "Mutated returned value";

    const stored = await store.read("run-001");
    expect(stored).toMatchObject({ version: 1, status: "AWAITING_APPROVAL" });
    expect(stored.order.supplierName).toBe("Northstar Components");
    expect(stored.order.purchaseOrderRef).toBe("PO-2048");
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it("ignores an interrupted temporary file as non-authoritative", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock: new MutableClock() });
    await store.create(createRun());
    await writeFile(
      join(root, "run-001.interrupted.tmp"),
      JSON.stringify({ ...createRun(), version: 99 }),
      "utf8",
    );

    expect((await store.read("run-001")).version).toBe(0);
  });

  it("recovers one strictly valid stale lock using only the injected clock", async () => {
    const root = await createRoot();
    const clock = new MutableClock("2026-08-08T12:01:00.000Z");
    const store = new FileRunStore({ root, clock });
    await store.create(createRun());
    await writeFile(
      join(root, "run-001.lock"),
      JSON.stringify({
        version: 1,
        createdAt: "2026-08-08T12:00:00.000Z",
        token: "a".repeat(32),
      }),
      "utf8",
    );

    const result = await store.compareAndSwap(
      "run-001",
      0,
      createRun({ version: 1, status: "AWAITING_APPROVAL" }),
    );

    expect(result.version).toBe(1);
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it("fails closed on a fresh or malformed lock without removing it", async () => {
    const root = await createRoot();
    const clock = new MutableClock();
    const store = new FileRunStore({ root, clock });
    await store.create(createRun());
    const lockPath = join(root, "run-001.lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        createdAt: fixedNow,
        token: "b".repeat(32),
      }),
      "utf8",
    );

    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        0,
        createRun({ version: 1, status: "AWAITING_APPROVAL" }),
      ),
      "RUN_STORE_LOCKED",
      root,
    );
    expect(await readdir(root)).toContain("run-001.lock");

    await writeFile(lockPath, `{"createdAt":"${privatePhone}"}`, "utf8");
    clock.set("2027-08-08T12:00:00.000Z");
    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        0,
        createRun({ version: 1, status: "AWAITING_APPROVAL" }),
      ),
      "RUN_STORE_LOCKED",
      root,
    );
    expect(await readdir(root)).toContain("run-001.lock");
  });

  it("cleans its temporary file when create-only placement fails", async () => {
    const root = await createRoot();
    await mkdir(join(root, "run-001.json"));
    const store = new FileRunStore({ root, clock: new MutableClock() });

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_ALREADY_EXISTS",
      root,
    );
    expect(await auxiliaryFiles(root)).toEqual([]);
  });
});
