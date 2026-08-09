import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../application/ports.js";
import type { RunRecord } from "../../domain/run.js";
import { FileRunStore } from "./run-store.js";

const filesystemInterception = vi.hoisted(() => ({
  rewritePublicationBytes: undefined as
    ((serialized: string) => string) | undefined,
  beforePublicationLink: undefined as
    ((temporaryPath: string, finalPath: string) => Promise<void>) | undefined,
  afterPublicationLink: undefined as
    ((temporaryPath: string, finalPath: string) => Promise<void>) | undefined,
  afterPublicationHandleClose: undefined as
    ((temporaryPath: string) => Promise<void>) | undefined,
  beforeUnlink: undefined as ((path: string) => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const [path, flags] = args;
      const handle = await actual.open(...args);
      if (
        typeof path !== "string" ||
        typeof flags !== "string" ||
        !flags.includes("x")
      ) {
        return handle;
      }
      return new Proxy(handle, {
        get(target, property) {
          if (property === "writeFile") {
            return async (
              ...writeArgs: Parameters<typeof target.writeFile>
            ) => {
              const [data, options] = writeArgs;
              const replacement =
                typeof data === "string" &&
                filesystemInterception.rewritePublicationBytes !== undefined
                  ? filesystemInterception.rewritePublicationBytes(data)
                  : data;
              return target.writeFile(replacement, options);
            };
          }
          if (property === "close") {
            return async () => {
              await target.close();
              if (
                filesystemInterception.afterPublicationHandleClose !== undefined
              ) {
                await filesystemInterception.afterPublicationHandleClose(path);
              }
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    link: async (...args: Parameters<typeof actual.link>) => {
      const [temporaryPath, finalPath] = args;
      if (
        typeof temporaryPath === "string" &&
        typeof finalPath === "string" &&
        filesystemInterception.beforePublicationLink !== undefined
      ) {
        await filesystemInterception.beforePublicationLink(
          temporaryPath,
          finalPath,
        );
      }
      const result = await actual.link(...args);
      if (
        typeof temporaryPath === "string" &&
        typeof finalPath === "string" &&
        filesystemInterception.afterPublicationLink !== undefined
      ) {
        await filesystemInterception.afterPublicationLink(
          temporaryPath,
          finalPath,
        );
      }
      return result;
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      const [path] = args;
      if (
        typeof path === "string" &&
        filesystemInterception.beforeUnlink !== undefined
      ) {
        await filesystemInterception.beforeUnlink(path);
      }
      return actual.unlink(...args);
    },
  };
});

const fixedNow = "2026-08-08T12:00:00.000Z";
const privatePhone = "+12025550123";
const VERSION_ZERO = "run-001.v0000000000000000.json";
const VERSION_ONE = "run-001.v0000000000000001.json";

const clock: Clock = {
  now: () => fixedNow,
  sleep: async () => undefined,
};

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

function versionFileName(runId: string, version: number): string {
  return `${runId}.v${String(version).padStart(16, "0")}.json`;
}

const cleanupPaths: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supplysignal-run-store-"));
  cleanupPaths.push(root);
  return root;
}

async function createOutsideFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "supplysignal-outside-"));
  cleanupPaths.push(directory);
  const path = join(directory, "private.json");
  await writeFile(path, content, "utf8");
  return path;
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
  filesystemInterception.rewritePublicationBytes = undefined;
  filesystemInterception.beforePublicationLink = undefined;
  filesystemInterception.afterPublicationLink = undefined;
  filesystemInterception.afterPublicationHandleClose = undefined;
  filesystemInterception.beforeUnlink = undefined;
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileRunStore", () => {
  it("publishes immutable version zero and reads a detached record", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const run = createRun();

    await store.create(run);
    run.order.supplierName = "Mutated caller value";

    const stored = await store.read("run-001");
    expect(stored.order.supplierName).toBe("Northstar Components");
    expect(stored).not.toBe(run);
    expect(stored.order).not.toBe(run.order);
    expect(await readdir(root)).toEqual([VERSION_ZERO]);
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
    const store = new FileRunStore({ root, clock });
    const outside = await createOutsideFile("outside");

    await expectBoundedFailure(store.read(runId), "RUN_STORE_INVALID_ID", root);
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(outside, "utf8")).toBe("outside");
  });

  it("stores a grammar-valid device-like id as a regular confined file", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });

    await store.create(createRun({ id: "con" }));

    expect((await store.read("con")).id).toBe("con");
    const files = await readdir(root);
    expect(files).toEqual(["con.v0000000000000000.json"]);
    expect((await lstat(join(root, files[0] ?? "missing"))).isFile()).toBe(
      true,
    );
  });

  it("never overwrites immutable version zero", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
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
    expect(await readdir(root)).toEqual([VERSION_ZERO]);
  });

  it.each([
    [
      "create",
      (store: FileRunStore) =>
        store.create(createRun({ id: "run-after-replacement" })),
    ],
    ["read", (store: FileRunStore) => store.read("run-001")],
    [
      "compare-and-swap",
      (store: FileRunStore) =>
        store.compareAndSwap(
          "run-001",
          0,
          createRun({ version: 1, status: "AWAITING_APPROVAL" }),
        ),
    ],
  ] as const)(
    "rejects persistent root replacement before %s",
    async (_operationName, operation) => {
      const root = await createRoot();
      const displacedRoot = `${root}-displaced`;
      cleanupPaths.push(displacedRoot);
      const store = new FileRunStore({ root, clock });
      await store.create(createRun());
      await rename(root, displacedRoot);
      await mkdir(root);

      await expectBoundedFailure(
        operation(store),
        "RUN_STORE_INVALID_ROOT",
        root,
      );
      expect(await readdir(root)).toEqual([]);
      expect(await readdir(displacedRoot)).toEqual([VERSION_ZERO]);
    },
  );

  it("rejects a preplanted valid future version before create", async () => {
    const root = await createRoot();
    await writeFile(
      join(root, VERSION_ONE),
      JSON.stringify(createRun({ version: 1 })),
      "utf8",
    );
    const store = new FileRunStore({ root, clock });

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_ALREADY_EXISTS",
      root,
    );
    expect(await readdir(root)).toEqual([VERSION_ONE]);
  });

  it("rejects same-length opened-handle bytes that differ from the canonical record", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const run = createRun();
    const canonical = JSON.stringify(run);
    const altered = JSON.stringify(
      createRun({
        order: {
          ...run.order,
          supplierName: "Southstar Components",
        },
      }),
    );
    expect(altered).not.toBe(canonical);
    expect(Buffer.byteLength(altered, "utf8")).toBe(
      Buffer.byteLength(canonical, "utf8"),
    );
    filesystemInterception.rewritePublicationBytes = () => altered;

    await expectBoundedFailure(
      store.create(run),
      "RUN_STORE_WRITE_FAILED",
      root,
    );
    expect(run.order.supplierName).toBe("Northstar Components");
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("preserves both roots when replacement follows publication-handle close", async () => {
    const root = await createRoot();
    const displacedRoot = `${root}-displaced`;
    cleanupPaths.push(displacedRoot);
    const store = new FileRunStore({ root, clock });
    const replacementFinal = "unrelated replacement final";
    const replacementTemporary = "unrelated replacement temporary";
    let temporaryName: string | undefined;
    filesystemInterception.afterPublicationHandleClose = async (
      temporaryPath,
    ) => {
      temporaryName = temporaryPath.slice(root.length + 1);
      await rename(root, displacedRoot);
      await mkdir(root);
      await writeFile(join(root, VERSION_ZERO), replacementFinal, "utf8");
      await writeFile(join(root, temporaryName), replacementTemporary, "utf8");
    };

    const [outcome] = await Promise.allSettled([store.create(createRun())]);

    expect(temporaryName).toContain("run-001.");
    expect.soft(outcome).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: "RUN_STORE_INVALID_ROOT" }),
    });
    expect
      .soft((await readdir(root)).sort())
      .toEqual([VERSION_ZERO, temporaryName as string].sort());
    expect
      .soft(await readFile(join(root, VERSION_ZERO), "utf8"))
      .toBe(replacementFinal);
    expect
      .soft(
        await readFile(join(root, temporaryName as string), "utf8").catch(
          () => undefined,
        ),
      )
      .toBe(replacementTemporary);
    const displacedFinalStats = await lstat(join(displacedRoot, VERSION_ZERO), {
      bigint: true,
    });
    const displacedTemporaryStats = await lstat(
      join(displacedRoot, temporaryName as string),
      { bigint: true },
    );
    expect(displacedFinalStats.nlink).toBe(2n);
    expect(displacedTemporaryStats.nlink).toBe(2n);
    expect(displacedFinalStats.ino).toBe(displacedTemporaryStats.ino);
    if (outcome?.status === "rejected") {
      const exposed = `${String(outcome.reason)} ${JSON.stringify(outcome.reason)}`;
      expect(exposed).not.toContain(privatePhone);
      expect(exposed).not.toContain(root);
    }
  });

  it("removes an identical-byte substituted final after rejecting publication", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    let synchronizedTemporaryPath: string | undefined;
    let replacementBytesMatch = false;
    let replacementIdentityDiffers = false;
    filesystemInterception.beforePublicationLink = async (
      temporaryPath,
      finalPath,
    ) => {
      if (finalPath.endsWith(VERSION_ZERO)) {
        synchronizedTemporaryPath = temporaryPath;
        const synchronizedStats = await lstat(temporaryPath, { bigint: true });
        const synchronizedBytes = await readFile(temporaryPath);
        await rename(temporaryPath, `${temporaryPath}.displaced`);
        await writeFile(temporaryPath, synchronizedBytes);
        const replacementStats = await lstat(temporaryPath, { bigint: true });
        const replacementBytes = await readFile(temporaryPath);
        replacementBytesMatch = synchronizedBytes.equals(replacementBytes);
        replacementIdentityDiffers =
          synchronizedStats.dev !== replacementStats.dev ||
          synchronizedStats.ino !== replacementStats.ino;
      }
    };

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_WRITE_FAILED",
      root,
    );
    expect(synchronizedTemporaryPath).toContain("run-001.");
    expect(replacementBytesMatch).toBe(true);
    expect(replacementIdentityDiffers).toBe(true);
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
    expect(await readdir(root)).not.toContain(VERSION_ZERO);
  });

  it("preserves two-link fail-closed state when substituted-final rollback fails", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const finalPath = join(root, VERSION_ZERO);
    let temporaryPath: string | undefined;
    filesystemInterception.beforePublicationLink = async (
      candidateTemporaryPath,
      candidateFinalPath,
    ) => {
      if (candidateFinalPath === finalPath) {
        temporaryPath = candidateTemporaryPath;
        const synchronizedBytes = await readFile(candidateTemporaryPath);
        await rename(
          candidateTemporaryPath,
          `${candidateTemporaryPath}.displaced`,
        );
        await writeFile(candidateTemporaryPath, synchronizedBytes);
      }
    };
    filesystemInterception.beforeUnlink = async (path) => {
      if (path === finalPath) {
        throw Object.assign(new Error("forced final rollback failure"), {
          code: "EACCES",
        });
      }
    };

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_WRITE_FAILED",
      root,
    );
    expect(temporaryPath).toContain("run-001.");
    const finalStats = await lstat(finalPath, { bigint: true });
    const temporaryStats = await lstat(temporaryPath as string, {
      bigint: true,
    });
    expect(finalStats.nlink).toBe(2n);
    expect(temporaryStats.nlink).toBe(2n);
    expect(finalStats.dev).toBe(temporaryStats.dev);
    expect(finalStats.ino).toBe(temporaryStats.ino);
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        0,
        createRun({ version: 1, status: "AWAITING_APPROVAL" }),
      ),
      "RUN_STORE_READ_FAILED",
      root,
    );
    expect(await readdir(root)).not.toContain(VERSION_ONE);
  });

  it("rejects schema-invalid and accessor-backed records before writing", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const accessorRun = createRun();
    let getterCalls = 0;
    Object.defineProperty(accessorRun, "id", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "run-001";
      },
    });

    await expectBoundedFailure(
      store.create(createRun({ status: "INVALID" as RunRecord["status"] })),
      "RUN_STORE_INVALID_RECORD",
      root,
    );
    await expectBoundedFailure(
      store.create(accessorRun),
      "RUN_STORE_INVALID_RECORD",
      root,
    );
    expect(getterCalls).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it("fails closed when record proxy reflection throws", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const proxied = new Proxy(createRun(), {
      ownKeys() {
        throw new Error(`${privatePhone} proxy trap`);
      },
    });

    await expectBoundedFailure(
      store.create(proxied),
      "RUN_STORE_INVALID_RECORD",
      root,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("fails closed on malformed JSON, schema corruption, and oversized data", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const path = join(root, VERSION_ZERO);

    await writeFile(path, `{${privatePhone}`, "utf8");
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );

    await writeFile(
      path,
      JSON.stringify({ ...createRun(), unexpected: privatePhone }),
      "utf8",
    );
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );

    await writeFile(path, "x".repeat(1_048_577), "utf8");
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("rejects gaps and a missing version-zero start", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    await writeFile(
      join(root, versionFileName("run-001", 1)),
      JSON.stringify(createRun({ version: 1 })),
      "utf8",
    );

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );

    await writeFile(
      join(root, VERSION_ZERO),
      JSON.stringify(createRun()),
      "utf8",
    );
    await rm(join(root, versionFileName("run-001", 1)));
    await writeFile(
      join(root, versionFileName("run-001", 2)),
      JSON.stringify(createRun({ version: 2 })),
      "utf8",
    );
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("rejects malformed version filenames for the requested run", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    await writeFile(
      join(root, VERSION_ZERO),
      JSON.stringify(createRun()),
      "utf8",
    );
    await writeFile(
      join(root, "run-001.v1.json"),
      JSON.stringify(createRun({ version: 1 })),
      "utf8",
    );

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it.each([
    ["record id", createRun({ id: "run-002" })],
    ["record version", createRun({ version: 7 })],
  ] as const)("rejects a filename-to-%s mismatch", async (_name, record) => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    await writeFile(join(root, VERSION_ZERO), JSON.stringify(record), "utf8");

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("fails closed above 1024 matching version files", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const writes: Promise<void>[] = [];
    for (let version = 0; version < 1_025; version += 1) {
      writes.push(
        writeFile(
          join(root, versionFileName("run-001", version)),
          JSON.stringify(createRun({ version })),
          "utf8",
        ),
      );
    }
    await Promise.all(writes);

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("publishes expectedVersion plus one without modifying prior versions", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    await store.create(createRun());
    const originalVersionZero = await readFile(
      join(root, VERSION_ZERO),
      "utf8",
    );
    const next = createRun({ version: 1, status: "AWAITING_APPROVAL" });

    const result = await store.compareAndSwap("run-001", 0, next);

    expect(result).toMatchObject({ version: 1, status: "AWAITING_APPROVAL" });
    expect(await readFile(join(root, VERSION_ZERO), "utf8")).toBe(
      originalVersionZero,
    );
    expect((await store.read("run-001")).version).toBe(1);
    expect((await readdir(root)).sort()).toEqual([VERSION_ZERO, VERSION_ONE]);
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it("rejects stale expectations, id mismatches, and next-version mismatches", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
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
  });

  it("ignores a crash-before-link temporary file", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    await store.create(createRun());
    await writeFile(
      join(root, `run-001.${"a".repeat(32)}.tmp`),
      JSON.stringify(createRun({ version: 99 })),
      "utf8",
    );

    expect((await store.read("run-001")).version).toBe(0);
  });

  it("rejects a two-link crash-after-link version as uncommitted", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const temporaryPath = join(root, `run-001.${"b".repeat(32)}.tmp`);
    await writeFile(temporaryPath, JSON.stringify(createRun()), "utf8");
    await link(temporaryPath, join(root, VERSION_ZERO));

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        0,
        createRun({ version: 1, status: "AWAITING_APPROVAL" }),
      ),
      "RUN_STORE_READ_FAILED",
      root,
    );
    expect(
      (await lstat(join(root, VERSION_ZERO), { bigint: true })).nlink,
    ).toBe(2n);
    expect(await readdir(root)).not.toContain(VERSION_ONE);
  });

  it("keeps a linked version unreadable until temporary unlink commits it", async () => {
    const root = await createRoot();
    const first = new FileRunStore({ root, clock });
    const second = new FileRunStore({ root, clock });
    let observeLink!: () => void;
    let releaseLink!: () => void;
    const linkObserved = new Promise<void>((resolve) => {
      observeLink = resolve;
    });
    const linkReleased = new Promise<void>((resolve) => {
      releaseLink = resolve;
    });
    filesystemInterception.afterPublicationLink = async (
      _temporaryPath,
      finalPath,
    ) => {
      if (finalPath.endsWith(VERSION_ZERO)) {
        observeLink();
        await linkReleased;
      }
    };

    const publication = first.create(createRun());
    await linkObserved;
    try {
      const blocked = await Promise.allSettled([
        second.read("run-001"),
        second.compareAndSwap(
          "run-001",
          0,
          createRun({ version: 1, status: "AWAITING_APPROVAL" }),
        ),
      ]);
      expect(blocked).toEqual([
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ message: "RUN_STORE_READ_FAILED" }),
        }),
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ message: "RUN_STORE_READ_FAILED" }),
        }),
      ]);
      expect(
        (await lstat(join(root, VERSION_ZERO), { bigint: true })).nlink,
      ).toBe(2n);
      expect(await readdir(root)).not.toContain(VERSION_ONE);
    } finally {
      releaseLink();
      await Promise.allSettled([publication]);
    }

    await expect(publication).resolves.toBeUndefined();
    expect(
      (await lstat(join(root, VERSION_ZERO), { bigint: true })).nlink,
    ).toBe(1n);
    expect((await second.read("run-001")).version).toBe(0);
    await second.compareAndSwap(
      "run-001",
      0,
      createRun({ version: 1, status: "AWAITING_APPROVAL" }),
    );
    expect((await lstat(join(root, VERSION_ONE), { bigint: true })).nlink).toBe(
      1n,
    );
  });

  it("rejects a symlink candidate without reading its outside target", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const outside = await createOutsideFile(JSON.stringify(createRun()));
    try {
      await symlink(outside, join(root, VERSION_ZERO), "file");
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "EPERM"
      ) {
        console.warn("Symlink regression unavailable: Windows returned EPERM");
        return;
      }
      throw error;
    }

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("rejects a hard-link candidate to an outside-root file", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const outside = await createOutsideFile(JSON.stringify(createRun()));
    await link(outside, join(root, VERSION_ZERO));

    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
    expect(await readFile(outside, "utf8")).toContain("run-001");
  });

  it("cleans its temporary file when create-only publication fails", async () => {
    const root = await createRoot();
    await mkdir(join(root, VERSION_ZERO));
    const store = new FileRunStore({ root, clock });

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_ALREADY_EXISTS",
      root,
    );
    expect(await auxiliaryFiles(root)).toEqual([]);
  });

  it("rejects temporary-unlink failure and removes the rolled-back final", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    let temporaryPath: string | undefined;
    let remainingTemporaryFailures = 1;
    filesystemInterception.beforePublicationLink = async (path) => {
      temporaryPath = path;
    };
    filesystemInterception.beforeUnlink = async (path) => {
      if (path === temporaryPath && remainingTemporaryFailures > 0) {
        remainingTemporaryFailures -= 1;
        throw Object.assign(new Error("forced temporary unlink failure"), {
          code: "EACCES",
        });
      }
    };

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_WRITE_FAILED",
      root,
    );
    expect(await readdir(root)).not.toContain(VERSION_ZERO);
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
  });

  it("preserves both links when temporary unlink and final rollback fail", async () => {
    const root = await createRoot();
    const store = new FileRunStore({ root, clock });
    const finalPath = join(root, VERSION_ZERO);
    let temporaryPath: string | undefined;
    filesystemInterception.beforePublicationLink = async (path) => {
      temporaryPath = path;
    };
    filesystemInterception.beforeUnlink = async (path) => {
      if (path === temporaryPath || path === finalPath) {
        throw Object.assign(new Error("forced unlink failure"), {
          code: "EACCES",
        });
      }
    };

    await expectBoundedFailure(
      store.create(createRun()),
      "RUN_STORE_WRITE_FAILED",
      root,
    );
    expect(temporaryPath).toContain("run-001.");
    const finalStats = await lstat(finalPath, { bigint: true });
    const temporaryStats = await lstat(temporaryPath as string, {
      bigint: true,
    });
    expect(finalStats.nlink).toBe(2n);
    expect(temporaryStats.nlink).toBe(2n);
    expect(finalStats.ino).toBe(temporaryStats.ino);
    await expectBoundedFailure(
      store.read("run-001"),
      "RUN_STORE_READ_FAILED",
      root,
    );
    await expectBoundedFailure(
      store.compareAndSwap(
        "run-001",
        0,
        createRun({ version: 1, status: "AWAITING_APPROVAL" }),
      ),
      "RUN_STORE_READ_FAILED",
      root,
    );
    expect(await readdir(root)).not.toContain(VERSION_ONE);
  });
});
