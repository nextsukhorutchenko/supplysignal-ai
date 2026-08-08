import { randomBytes } from "node:crypto";
import {
  link,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { Clock, RunStore } from "../../application/ports.js";
import { runRecordSchema, type RunRecord } from "../../domain/run.js";

const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_RUN_FILE_BYTES = 1_048_576;
const MAX_LOCK_FILE_BYTES = 512;
const STALE_LOCK_MILLISECONDS = 30_000;
const LOCK_VERSION = 1;
const TOKEN = /^[a-f0-9]{32}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type RunStoreFailureCode =
  | "RUN_STORE_INVALID_ROOT"
  | "RUN_STORE_INVALID_ID"
  | "RUN_STORE_INVALID_RECORD"
  | "RUN_STORE_ALREADY_EXISTS"
  | "RUN_STORE_READ_FAILED"
  | "RUN_STORE_WRITE_FAILED"
  | "RUN_STORE_CONFLICT"
  | "RUN_STORE_LOCKED";

type LockRecord = {
  version: typeof LOCK_VERSION;
  createdAt: string;
  token: string;
};

class RunStoreFailure extends Error {
  constructor(readonly code: RunStoreFailureCode) {
    super(code);
    this.name = "RunStoreFailure";
  }
}

function fail(code: RunStoreFailureCode): never {
  throw new RunStoreFailure(code);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function preserveOrFail(error: unknown, fallback: RunStoreFailureCode): never {
  if (error instanceof RunStoreFailure) {
    throw error;
  }
  fail(fallback);
}

function randomToken(failureCode: RunStoreFailureCode): string {
  try {
    return randomBytes(16).toString("hex");
  } catch {
    fail(failureCode);
  }
}

function parseTimestamp(value: string): number | null {
  if (!ISO_TIMESTAMP.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    return null;
  }
  return milliseconds;
}

function parseLockRecord(value: unknown): LockRecord | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "createdAt" ||
    keys[1] !== "token" ||
    keys[2] !== "version"
  ) {
    return null;
  }

  for (const descriptor of Object.values(descriptors)) {
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return null;
    }
  }

  const version = descriptors.version?.value;
  const createdAt = descriptors.createdAt?.value;
  const token = descriptors.token?.value;
  if (
    version !== LOCK_VERSION ||
    typeof createdAt !== "string" ||
    parseTimestamp(createdAt) === null ||
    typeof token !== "string" ||
    !TOKEN.test(token)
  ) {
    return null;
  }

  return { version, createdAt, token };
}

async function closeBestEffort(handle: FileHandle | undefined): Promise<void> {
  if (handle === undefined) {
    return;
  }
  try {
    await handle.close();
  } catch {
    // The public operation maps any prior failure; cleanup never leaks details.
  }
}

async function unlinkBestEffort(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Temporary-file cleanup is deliberately best effort and bounded.
  }
}

async function writeExclusiveSynced(path: string, data: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await closeBestEffort(handle);
  }
}

async function readBounded(path: string, limit: number): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (result.bytesRead === 0) {
        break;
      }
      offset += result.bytesRead;
    }
    if (offset > limit) {
      throw new RunStoreFailure("RUN_STORE_READ_FAILED");
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await closeBestEffort(handle);
  }
}

export class FileRunStore implements RunStore {
  readonly #root: string;
  readonly #clock: Clock;

  constructor(options: { root: string; clock: Clock }) {
    if (
      typeof options.root !== "string" ||
      options.root.trim().length === 0 ||
      options.root.includes("\0")
    ) {
      fail("RUN_STORE_INVALID_ROOT");
    }
    this.#root = resolve(options.root);
    this.#clock = options.clock;
  }

  async create(run: RunRecord): Promise<void> {
    const record = this.#validateRecord(run);
    const runId = this.#validateRunId(record.id);
    const finalPath = this.#childPath(`${runId}.json`);
    const temporaryPath = this.#temporaryPath(runId);

    try {
      await this.#ensureRoot();
      await writeExclusiveSynced(temporaryPath, JSON.stringify(record));
      try {
        await link(temporaryPath, finalPath);
      } catch (error: unknown) {
        if (isNodeError(error, "EEXIST")) {
          fail("RUN_STORE_ALREADY_EXISTS");
        }
        throw error;
      }
    } catch (error: unknown) {
      preserveOrFail(error, "RUN_STORE_WRITE_FAILED");
    } finally {
      await unlinkBestEffort(temporaryPath);
    }
  }

  async read(runId: string): Promise<RunRecord> {
    const validRunId = this.#validateRunId(runId);
    try {
      await this.#ensureRoot();
      return await this.#readRecord(this.#childPath(`${validRunId}.json`));
    } catch (error: unknown) {
      preserveOrFail(error, "RUN_STORE_READ_FAILED");
    }
  }

  async compareAndSwap(
    runId: string,
    expectedVersion: number,
    next: RunRecord,
  ): Promise<RunRecord> {
    const validRunId = this.#validateRunId(runId);
    const nextRecord = this.#validateRecord(next);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      nextRecord.id !== validRunId ||
      nextRecord.version !== expectedVersion + 1
    ) {
      fail("RUN_STORE_CONFLICT");
    }

    await this.#ensureRoot();
    const lockPath = this.#childPath(`${validRunId}.lock`);
    const finalPath = this.#childPath(`${validRunId}.json`);
    const temporaryPath = this.#temporaryPath(validRunId);
    const token = await this.#acquireLock(lockPath);

    try {
      const current = await this.#readRecord(finalPath);
      if (current.id !== validRunId || current.version !== expectedVersion) {
        fail("RUN_STORE_CONFLICT");
      }

      await writeExclusiveSynced(temporaryPath, JSON.stringify(nextRecord));
      await rename(temporaryPath, finalPath);
      return this.#validateRecord(nextRecord);
    } catch (error: unknown) {
      preserveOrFail(error, "RUN_STORE_WRITE_FAILED");
    } finally {
      await unlinkBestEffort(temporaryPath);
      await this.#releaseLock(lockPath, token);
    }
  }

  #validateRunId(runId: string): string {
    if (typeof runId !== "string" || !RUN_ID.test(runId)) {
      fail("RUN_STORE_INVALID_ID");
    }
    return runId;
  }

  #validateRecord(value: unknown): RunRecord {
    const parsed = runRecordSchema.safeParse(value);
    if (!parsed.success) {
      fail("RUN_STORE_INVALID_RECORD");
    }
    return parsed.data;
  }

  #childPath(fileName: string): string {
    const child = resolve(this.#root, fileName);
    const pathFromRoot = relative(this.#root, child);
    if (
      pathFromRoot.length === 0 ||
      pathFromRoot.startsWith("..") ||
      isAbsolute(pathFromRoot)
    ) {
      fail("RUN_STORE_INVALID_ID");
    }
    return child;
  }

  #temporaryPath(runId: string): string {
    return this.#childPath(
      `${runId}.${randomToken("RUN_STORE_WRITE_FAILED")}.tmp`,
    );
  }

  async #ensureRoot(): Promise<void> {
    try {
      await mkdir(this.#root, { recursive: true });
    } catch {
      fail("RUN_STORE_WRITE_FAILED");
    }
  }

  async #readRecord(path: string): Promise<RunRecord> {
    try {
      const serialized = await readBounded(path, MAX_RUN_FILE_BYTES);
      return this.#validateRecord(JSON.parse(serialized) as unknown);
    } catch {
      fail("RUN_STORE_READ_FAILED");
    }
  }

  async #acquireLock(lockPath: string): Promise<string> {
    const token = randomToken("RUN_STORE_LOCKED");
    let createdAt: string;
    try {
      createdAt = this.#clock.now();
    } catch {
      fail("RUN_STORE_LOCKED");
    }
    if (parseTimestamp(createdAt) === null) {
      fail("RUN_STORE_LOCKED");
    }
    const record: LockRecord = { version: LOCK_VERSION, createdAt, token };

    try {
      await writeExclusiveSynced(lockPath, JSON.stringify(record));
      return token;
    } catch (error: unknown) {
      if (!isNodeError(error, "EEXIST")) {
        preserveOrFail(error, "RUN_STORE_LOCKED");
      }
    }

    if (!(await this.#removeOneStaleLock(lockPath))) {
      fail("RUN_STORE_LOCKED");
    }

    try {
      await writeExclusiveSynced(lockPath, JSON.stringify(record));
      return token;
    } catch {
      fail("RUN_STORE_LOCKED");
    }
  }

  async #removeOneStaleLock(lockPath: string): Promise<boolean> {
    try {
      const original = await readBounded(lockPath, MAX_LOCK_FILE_BYTES);
      const record = parseLockRecord(JSON.parse(original) as unknown);
      const now = parseTimestamp(this.#clock.now());
      const createdAt =
        record === null ? null : parseTimestamp(record.createdAt);
      if (
        record === null ||
        now === null ||
        createdAt === null ||
        now - createdAt < STALE_LOCK_MILLISECONDS
      ) {
        return false;
      }

      const unchanged = await readBounded(lockPath, MAX_LOCK_FILE_BYTES);
      if (unchanged !== original) {
        return false;
      }
      await unlink(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  async #releaseLock(lockPath: string, token: string): Promise<void> {
    try {
      const serialized = await readBounded(lockPath, MAX_LOCK_FILE_BYTES);
      const record = parseLockRecord(JSON.parse(serialized) as unknown);
      if (record?.token === token) {
        await unlink(lockPath);
      }
    } catch {
      // A missing or changed lock is never removed based on stale ownership.
    }
  }
}
