import { randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { Clock, RunStore } from "../../application/ports.js";
import { runRecordSchema, type RunRecord } from "../../domain/run.js";

const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TEMP_TOKEN = /^[a-f0-9]{32}$/;
const MAX_RUN_FILE_BYTES = 1_048_576;
const MAX_VERSION_FILES = 1_024;
const MAX_TEMP_FILES = 1_024;
const VERSION_DIGITS = 16;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

type RunStoreFailureCode =
  | "RUN_STORE_INVALID_ROOT"
  | "RUN_STORE_INVALID_ID"
  | "RUN_STORE_INVALID_RECORD"
  | "RUN_STORE_ALREADY_EXISTS"
  | "RUN_STORE_READ_FAILED"
  | "RUN_STORE_WRITE_FAILED"
  | "RUN_STORE_CONFLICT";

type VersionCandidate = {
  path: string;
  version: number;
};

type ScanResult = {
  candidates: VersionCandidate[];
  temporaryPaths: string[];
};

type RootSnapshot = {
  canonicalPath: string;
  stats: BigIntStats;
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

function randomToken(): string {
  try {
    return randomBytes(16).toString("hex");
  } catch {
    fail("RUN_STORE_WRITE_FAILED");
  }
}

async function unlinkBestEffort(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Cleanup cannot change the bounded result of the public operation.
  }
}

function sameIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function sameStableMetadata(first: BigIntStats, second: BigIntStats): boolean {
  return (
    sameIdentity(first, second) &&
    first.size === second.size &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs
  );
}

function unchangedFile(first: BigIntStats, second: BigIntStats): boolean {
  return (
    sameIdentity(first, second) &&
    first.size === second.size &&
    first.nlink === second.nlink &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class FileRunStore implements RunStore {
  readonly #configuredRoot: string;
  #rootSnapshot: RootSnapshot | undefined;

  constructor(options: { root: string; clock: Clock }) {
    if (
      typeof options.root !== "string" ||
      options.root.trim().length === 0 ||
      options.root.includes("\0")
    ) {
      fail("RUN_STORE_INVALID_ROOT");
    }
    this.#configuredRoot = resolve(options.root);
    void options.clock;
  }

  async create(run: RunRecord): Promise<void> {
    const record = this.#validateRecord(run);
    const runId = this.#validateRunId(record.id);
    if (record.version !== 0) {
      fail("RUN_STORE_INVALID_RECORD");
    }

    const root = await this.#ensureRoot("RUN_STORE_WRITE_FAILED");
    try {
      const existing = await this.#scan(root, runId, false);
      if (existing.candidates.length !== 0) {
        fail("RUN_STORE_ALREADY_EXISTS");
      }

      await this.#publish(root, runId, 0, record, "RUN_STORE_ALREADY_EXISTS");
      const records = await this.#readHistory(root, runId);
      if (
        records.length !== 1 ||
        JSON.stringify(records[0]) !== JSON.stringify(record)
      ) {
        fail("RUN_STORE_WRITE_FAILED");
      }
    } catch (error: unknown) {
      preserveOrFail(error, "RUN_STORE_WRITE_FAILED");
    } finally {
      await this.#verifyRoot("RUN_STORE_WRITE_FAILED");
    }
  }

  async read(runId: string): Promise<RunRecord> {
    const validRunId = this.#validateRunId(runId);
    try {
      const root = await this.#ensureRoot("RUN_STORE_READ_FAILED");
      const records = await this.#readHistory(root, validRunId);
      const latest = records.at(-1);
      if (latest === undefined) {
        fail("RUN_STORE_READ_FAILED");
      }
      return this.#validateRecord(latest);
    } catch (error: unknown) {
      preserveOrFail(error, "RUN_STORE_READ_FAILED");
    } finally {
      await this.#verifyRoot("RUN_STORE_READ_FAILED");
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

    try {
      const root = await this.#ensureRoot("RUN_STORE_WRITE_FAILED");
      const records = await this.#readHistory(root, validRunId);
      const current = records.at(-1);
      if (
        current === undefined ||
        current.version !== expectedVersion ||
        records.length >= MAX_VERSION_FILES
      ) {
        fail("RUN_STORE_CONFLICT");
      }

      await this.#publish(
        root,
        validRunId,
        expectedVersion + 1,
        nextRecord,
        "RUN_STORE_CONFLICT",
      );
      return this.#validateRecord(nextRecord);
    } catch (error: unknown) {
      preserveOrFail(error, "RUN_STORE_WRITE_FAILED");
    } finally {
      await this.#verifyRoot("RUN_STORE_WRITE_FAILED");
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

  #childPath(root: string, fileName: string): string {
    const child = resolve(root, fileName);
    const pathFromRoot = relative(root, child);
    if (
      pathFromRoot.length === 0 ||
      pathFromRoot.startsWith("..") ||
      isAbsolute(pathFromRoot)
    ) {
      fail("RUN_STORE_INVALID_ID");
    }
    return child;
  }

  #versionFileName(runId: string, version: number): string {
    return `${runId}.v${String(version).padStart(VERSION_DIGITS, "0")}.json`;
  }

  async #ensureRoot(
    failureCode: "RUN_STORE_READ_FAILED" | "RUN_STORE_WRITE_FAILED",
  ): Promise<string> {
    try {
      if (this.#rootSnapshot === undefined) {
        await mkdir(this.#configuredRoot, { recursive: true });
      }
      const snapshot = await this.#readRootSnapshot();
      if (this.#rootSnapshot === undefined) {
        this.#rootSnapshot = snapshot;
      } else if (
        this.#rootSnapshot.canonicalPath !== snapshot.canonicalPath ||
        !sameIdentity(this.#rootSnapshot.stats, snapshot.stats)
      ) {
        fail("RUN_STORE_INVALID_ROOT");
      }
      return snapshot.canonicalPath;
    } catch (error: unknown) {
      if (error instanceof RunStoreFailure) {
        throw error;
      }
      fail(failureCode);
    }
  }

  async #readRootSnapshot(): Promise<RootSnapshot> {
    const before = await lstat(this.#configuredRoot, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail("RUN_STORE_INVALID_ROOT");
    }
    const canonicalPath = await realpath(this.#configuredRoot);
    const after = await lstat(this.#configuredRoot, { bigint: true });
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      !sameIdentity(before, after)
    ) {
      fail("RUN_STORE_INVALID_ROOT");
    }
    return { canonicalPath, stats: after };
  }

  async #verifyRoot(
    failureCode: "RUN_STORE_READ_FAILED" | "RUN_STORE_WRITE_FAILED",
  ): Promise<string> {
    try {
      const pinned = this.#rootSnapshot;
      if (pinned === undefined) {
        fail("RUN_STORE_INVALID_ROOT");
      }
      const current = await this.#readRootSnapshot();
      if (
        pinned.canonicalPath !== current.canonicalPath ||
        !sameIdentity(pinned.stats, current.stats)
      ) {
        fail("RUN_STORE_INVALID_ROOT");
      }
      return current.canonicalPath;
    } catch (error: unknown) {
      if (error instanceof RunStoreFailure) {
        throw error;
      }
      fail(failureCode);
    }
  }

  async #publish(
    root: string,
    runId: string,
    version: number,
    record: RunRecord,
    conflictCode: "RUN_STORE_ALREADY_EXISTS" | "RUN_STORE_CONFLICT",
  ): Promise<void> {
    const finalPath = this.#childPath(
      root,
      this.#versionFileName(runId, version),
    );
    const temporaryPath = this.#childPath(
      root,
      `${runId}.${randomToken()}.tmp`,
    );

    let handle: FileHandle | undefined;
    let operationError: unknown;
    try {
      const serialized = JSON.stringify(record);
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      const opened = await handle.stat({ bigint: true });
      const beforePath = await lstat(temporaryPath, { bigint: true });
      if (
        !opened.isFile() ||
        !beforePath.isFile() ||
        beforePath.isSymbolicLink() ||
        opened.nlink !== 1n ||
        beforePath.nlink !== 1n ||
        opened.size !== BigInt(Buffer.byteLength(serialized, "utf8")) ||
        !sameStableMetadata(opened, beforePath)
      ) {
        fail("RUN_STORE_WRITE_FAILED");
      }

      if ((await this.#verifyRoot("RUN_STORE_WRITE_FAILED")) !== root) {
        fail("RUN_STORE_INVALID_ROOT");
      }
      try {
        await link(temporaryPath, finalPath);
      } catch (error: unknown) {
        if (isNodeError(error, "EEXIST")) {
          fail(conflictCode);
        }
        throw error;
      }
      if ((await this.#verifyRoot("RUN_STORE_WRITE_FAILED")) !== root) {
        fail("RUN_STORE_INVALID_ROOT");
      }

      const afterLink = await handle.stat({ bigint: true });
      const afterTemporaryPath = await lstat(temporaryPath, { bigint: true });
      const afterFinalPath = await lstat(finalPath, { bigint: true });
      if (
        !afterLink.isFile() ||
        !afterTemporaryPath.isFile() ||
        afterTemporaryPath.isSymbolicLink() ||
        !afterFinalPath.isFile() ||
        afterFinalPath.isSymbolicLink() ||
        afterLink.nlink !== 2n ||
        afterTemporaryPath.nlink !== 2n ||
        afterFinalPath.nlink !== 2n ||
        !sameIdentity(opened, afterLink) ||
        opened.size !== afterLink.size ||
        opened.mtimeNs !== afterLink.mtimeNs ||
        !sameStableMetadata(afterLink, afterTemporaryPath) ||
        !sameStableMetadata(afterLink, afterFinalPath)
      ) {
        fail("RUN_STORE_WRITE_FAILED");
      }
    } catch (error: unknown) {
      operationError = error;
    }

    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error: unknown) {
        operationError ??= error;
      }
    }
    await unlinkBestEffort(temporaryPath);
    if (operationError !== undefined) {
      preserveOrFail(operationError, "RUN_STORE_WRITE_FAILED");
    }
  }

  async #scan(
    root: string,
    runId: string,
    requireContiguousHistory = true,
  ): Promise<ScanResult> {
    const escapedId = escapeRegExp(runId);
    const versionPattern = new RegExp(
      `^${escapedId}\\.v(\\d{${VERSION_DIGITS}})\\.json$`,
    );
    const temporaryPattern = new RegExp(
      `^${escapedId}\\.([a-f0-9]{32})\\.tmp$`,
    );
    const malformedVersionPrefix = `${runId}.v`;
    const candidates: VersionCandidate[] = [];
    const temporaryPaths: string[] = [];
    const directory = await opendir(root);

    try {
      for await (const entry of directory) {
        const versionMatch = versionPattern.exec(entry.name);
        if (versionMatch !== null) {
          candidates.push({
            path: this.#childPath(root, entry.name),
            version: Number(versionMatch[1]),
          });
          if (candidates.length > MAX_VERSION_FILES) {
            fail("RUN_STORE_READ_FAILED");
          }
          continue;
        }

        if (entry.name.startsWith(malformedVersionPrefix)) {
          fail("RUN_STORE_READ_FAILED");
        }

        const temporaryMatch = temporaryPattern.exec(entry.name);
        if (
          temporaryMatch !== null &&
          TEMP_TOKEN.test(temporaryMatch[1] ?? "")
        ) {
          temporaryPaths.push(this.#childPath(root, entry.name));
          if (temporaryPaths.length > MAX_TEMP_FILES) {
            fail("RUN_STORE_READ_FAILED");
          }
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }

    candidates.sort((first, second) => first.version - second.version);
    if (requireContiguousHistory) {
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (
          candidate === undefined ||
          !Number.isSafeInteger(candidate.version) ||
          candidate.version !== index
        ) {
          fail("RUN_STORE_READ_FAILED");
        }
      }
    }
    return { candidates, temporaryPaths };
  }

  async #readHistory(root: string, runId: string): Promise<RunRecord[]> {
    try {
      const scan = await this.#scan(root, runId);
      if (scan.candidates.length === 0) {
        fail("RUN_STORE_READ_FAILED");
      }
      const records: RunRecord[] = [];
      for (const candidate of scan.candidates) {
        const serialized = await this.#readCandidate(
          candidate.path,
          scan.temporaryPaths,
        );
        const parsed = this.#validateRecord(JSON.parse(serialized) as unknown);
        if (parsed.id !== runId || parsed.version !== candidate.version) {
          fail("RUN_STORE_READ_FAILED");
        }
        records.push(parsed);
      }
      return records;
    } catch {
      fail("RUN_STORE_READ_FAILED");
    }
  }

  async #readCandidate(
    path: string,
    temporaryPaths: string[],
  ): Promise<string> {
    let handle: FileHandle | undefined;
    try {
      const before = await lstat(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) {
        fail("RUN_STORE_READ_FAILED");
      }
      handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
      const opened = await handle.stat({ bigint: true });
      const afterOpen = await lstat(path, { bigint: true });
      if (
        !opened.isFile() ||
        !afterOpen.isFile() ||
        afterOpen.isSymbolicLink() ||
        !sameIdentity(before, opened) ||
        !sameIdentity(opened, afterOpen) ||
        !(await this.#hasSafeLinkCount(opened, temporaryPaths))
      ) {
        fail("RUN_STORE_READ_FAILED");
      }
      if (opened.size > BigInt(MAX_RUN_FILE_BYTES)) {
        fail("RUN_STORE_READ_FAILED");
      }

      const buffer = Buffer.alloc(MAX_RUN_FILE_BYTES + 1);
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
      if (offset > MAX_RUN_FILE_BYTES) {
        fail("RUN_STORE_READ_FAILED");
      }

      const afterRead = await handle.stat({ bigint: true });
      const afterPath = await lstat(path, { bigint: true });
      if (
        !unchangedFile(opened, afterRead) ||
        !unchangedFile(afterRead, afterPath)
      ) {
        fail("RUN_STORE_READ_FAILED");
      }
      return buffer.subarray(0, offset).toString("utf8");
    } catch {
      fail("RUN_STORE_READ_FAILED");
    } finally {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
    }
    fail("RUN_STORE_READ_FAILED");
  }

  async #hasSafeLinkCount(
    opened: BigIntStats,
    temporaryPaths: string[],
  ): Promise<boolean> {
    if (opened.nlink === 1n) {
      return true;
    }
    if (opened.nlink !== 2n) {
      return false;
    }

    let matchingTemporaryLinks = 0;
    for (const temporaryPath of temporaryPaths) {
      try {
        const temporary = await lstat(temporaryPath, { bigint: true });
        if (
          temporary.isFile() &&
          !temporary.isSymbolicLink() &&
          sameIdentity(opened, temporary)
        ) {
          matchingTemporaryLinks += 1;
        }
      } catch {
        return false;
      }
    }
    return matchingTemporaryLinks === 1;
  }
}
