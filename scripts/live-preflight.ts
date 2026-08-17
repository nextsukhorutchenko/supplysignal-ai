import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { z } from "zod";

import { CalleClient } from "../src/adapters/calle/client.js";
import { FileRunStore } from "../src/adapters/filesystem/run-store.js";
import { authorizeRun } from "../src/application/authorize-run.js";
import { createRun } from "../src/application/create-run.js";
import type { CalleEventPage, Clock } from "../src/application/ports.js";
import { reconcileRun } from "../src/application/reconcile-run.js";
import { startRun } from "../src/application/start-run.js";
import {
  CallRecipientValidationError,
  createCallRecipient,
  getCallRecipientPresentation,
  type CallRecipient,
  type RecipientLanguage,
} from "../src/domain/call-recipient.js";
import { AppError } from "../src/domain/errors.js";
import { validatePreflightEvidenceIntegrity } from "../src/domain/preflight-integrity.js";
import {
  runRecordSchema,
  transitionRun,
  type ProviderEvidenceSnapshot,
  type RunRecord,
} from "../src/domain/run.js";

const AUTHORIZATION_PHRASE = "AUTHORIZE ONE CALL";
const SCRIPT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const CALLE_BASE_URL = "https://api.heycall-e.com";
const POLL_DELAY_MILLISECONDS = 5_000;
const MAX_POLL_READS = 60;
const MAX_EVENT_PAGES = 10;
const MAX_PRIVATE_EVIDENCE_BYTES = 1_048_576;
const SAFE_RUN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

const scenarioSchema = z.enum(["answered", "declined", "no_answer"]);

export type PreflightScenario = z.infer<typeof scenarioSchema>;

export type PreflightExecutionInput = {
  scenario: PreflightScenario;
  recipient: CallRecipient;
  apiKey: string;
};

export type PreflightExecutionResult = {
  run: RunRecord;
  events: CalleEventPage["events"];
};

type PreflightErrorCode =
  | "PREFLIGHT_CONFIGURATION_REQUIRED"
  | "PREFLIGHT_SCENARIO_INVALID"
  | "PREFLIGHT_INTERACTIVE_REQUIRED"
  | "PREFLIGHT_CALL_LIMIT_REACHED"
  | "AUTHORIZATION_REQUIRED"
  | "UNSUPPORTED_RECIPIENT_REGION"
  | "UNSUPPORTED_RECIPIENT_LANGUAGE"
  | "PROVIDER_RESULT_INVALID"
  | "CALL_OUTCOME_PENDING";

export class PreflightError extends Error {
  constructor(readonly code: PreflightErrorCode) {
    super(code);
    this.name = "PreflightError";
  }
}

export type PreflightProcessInput = {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  isInteractive: boolean;
  prompt(question: string): Promise<string>;
  execute(input: PreflightExecutionInput): Promise<PreflightExecutionResult>;
  writePrivateEvidence(result: PreflightExecutionResult): Promise<void>;
  writeOutput(message: string): void;
};

export type PreflightSummary = {
  scenario: PreflightScenario;
  maskedPhone: string;
  country: "United States" | "Kenya" | "Ukraine";
  language: RecipientLanguage;
  region: CallRecipient["region"];
  locale: CallRecipient["locale"];
  status: RunRecord["status"];
  providerStatus: ProviderEvidenceSnapshot["status"] | "not_available";
  eventCount: number;
};

type PermitReservation = symbol;

type ProcessPermit = Readonly<{
  reserve(): PermitReservation | undefined;
  release(reservation: PermitReservation): void;
  consume(reservation: PermitReservation): boolean;
}>;

const PROCESS_PERMIT_KEY = Symbol.for(
  "supplysignal.live-preflight.one-call-permit",
);

const BLOCKED_PROCESS_PERMIT: ProcessPermit = Object.freeze({
  reserve: () => undefined,
  release: () => undefined,
  consume: () => false,
});

function createProcessPermit(): ProcessPermit {
  let state:
    | { readonly kind: "available" }
    | { readonly kind: "reserved"; readonly token: PermitReservation }
    | { readonly kind: "consumed" } = { kind: "available" };

  return Object.freeze({
    reserve(): PermitReservation | undefined {
      if (state.kind !== "available") {
        return undefined;
      }
      const token = Symbol("preflight-permit-reservation");
      state = { kind: "reserved", token };
      return token;
    },
    release(token: PermitReservation): void {
      if (state.kind === "reserved" && state.token === token) {
        state = { kind: "available" };
      }
    },
    consume(token: PermitReservation): boolean {
      if (state.kind !== "reserved" || state.token !== token) {
        return false;
      }
      state = { kind: "consumed" };
      return true;
    },
  });
}

function isProcessPermit(value: unknown): value is ProcessPermit {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    typeof descriptors.reserve?.value === "function" &&
    typeof descriptors.release?.value === "function" &&
    typeof descriptors.consume?.value === "function"
  );
}

function getProcessPermit(): ProcessPermit {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      process,
      PROCESS_PERMIT_KEY,
    );
    if (descriptor !== undefined) {
      return "value" in descriptor && isProcessPermit(descriptor.value)
        ? descriptor.value
        : BLOCKED_PROCESS_PERMIT;
    }

    const permit = createProcessPermit();
    Object.defineProperty(process, PROCESS_PERMIT_KEY, {
      configurable: false,
      enumerable: false,
      value: permit,
      writable: false,
    });
    return permit;
  } catch {
    return BLOCKED_PROCESS_PERMIT;
  }
}

const processPermit = getProcessPermit();

function fail(code: PreflightErrorCode): never {
  throw new PreflightError(code);
}

function parseScenario(argv: readonly string[]): PreflightScenario {
  if (
    argv.length !== 2 ||
    argv[0] !== "--scenario" ||
    typeof argv[1] !== "string"
  ) {
    fail("PREFLIGHT_SCENARIO_INVALID");
  }
  const parsed = scenarioSchema.safeParse(argv[1]);
  if (!parsed.success) {
    fail("PREFLIGHT_SCENARIO_INVALID");
  }
  return parsed.data;
}

function requireConfiguration(env: PreflightProcessInput["env"]): {
  apiKey: string;
  recipient: CallRecipient;
  country: "United States" | "Kenya" | "Ukraine";
  language: RecipientLanguage;
} {
  const apiKey = env.CALLE_API_KEY;
  const phone = env.SUPPLIER_TEST_PHONE;
  const language = env.SUPPLIER_TEST_LANGUAGE;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    fail("PREFLIGHT_CONFIGURATION_REQUIRED");
  }
  if (typeof phone !== "string" || phone.length === 0) {
    fail("PREFLIGHT_CONFIGURATION_REQUIRED");
  }
  if (
    language !== undefined &&
    language !== "English" &&
    language !== "Ukrainian"
  ) {
    fail("UNSUPPORTED_RECIPIENT_LANGUAGE");
  }
  try {
    const recipient = createCallRecipient({
      recipientName: "Consenting participant",
      phoneE164: phone,
      ...(language === undefined ? {} : { language }),
    });
    const presentation = getCallRecipientPresentation(recipient);
    return { apiKey, recipient, ...presentation };
  } catch (error: unknown) {
    if (error instanceof CallRecipientValidationError) {
      fail(error.code);
    }
    fail("UNSUPPORTED_RECIPIENT_REGION");
  }
}

export function createPreflightProcess() {
  return async function runPreflight(
    input: PreflightProcessInput,
  ): Promise<PreflightSummary> {
    const scenario = parseScenario(input.argv);
    const configuration = requireConfiguration(input.env);
    if (!input.isInteractive) {
      fail("PREFLIGHT_INTERACTIVE_REQUIRED");
    }
    const reservation = processPermit.reserve();
    if (reservation === undefined) {
      fail("PREFLIGHT_CALL_LIMIT_REACHED");
    }

    try {
      input.writeOutput(
        [
          `Scenario: ${scenario}`,
          `Recipient: ${configuration.recipient.maskedPhone}`,
          `Country: ${configuration.country}`,
          `Language: ${configuration.language}`,
          `Region: ${configuration.recipient.region}`,
          `Locale: ${configuration.recipient.locale}`,
        ].join("\n"),
      );
      const confirmation = await input.prompt(`Type ${AUTHORIZATION_PHRASE}: `);
      if (confirmation !== AUTHORIZATION_PHRASE) {
        fail("AUTHORIZATION_REQUIRED");
      }
    } catch (error: unknown) {
      processPermit.release(reservation);
      throw error;
    }

    if (!processPermit.consume(reservation)) {
      fail("PREFLIGHT_CALL_LIMIT_REACHED");
    }
    const result = await input.execute({
      scenario,
      recipient: configuration.recipient,
      apiKey: configuration.apiKey,
    });
    await input.writePrivateEvidence(result);
    const summary: PreflightSummary = {
      scenario,
      maskedPhone: configuration.recipient.maskedPhone,
      country: configuration.country,
      language: configuration.language,
      region: configuration.recipient.region,
      locale: configuration.recipient.locale,
      status: result.run.status,
      providerStatus: result.run.providerSnapshot?.status ?? "not_available",
      eventCount: result.events.length,
    };
    try {
      input.writeOutput(JSON.stringify(summary));
    } catch {
      // Reporting cannot undo successfully committed private evidence.
    }
    return summary;
  };
}

const systemClock: Clock = {
  now: () => new Date().toISOString(),
  sleep: async (milliseconds) => {
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, milliseconds);
    });
  },
};

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function normalizedPath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function requireContained(parent: string, child: string): void {
  const fromParent = relative(parent, child);
  if (
    fromParent === "" ||
    fromParent === ".." ||
    fromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromParent)
  ) {
    fail("CALL_OUTCOME_PENDING");
  }
}

type DirectorySnapshot = {
  configuredPath: string;
  canonicalPath: string;
  stats: BigIntStats;
};

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

async function readDirectorySnapshot(path: string): Promise<DirectorySnapshot> {
  try {
    const configured = resolve(path);
    const before = await lstat(configured, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail("CALL_OUTCOME_PENDING");
    }
    const canonical = await realpath(configured);
    const after = await lstat(configured, { bigint: true });
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      !sameIdentity(before, after) ||
      normalizedPath(canonical) !== normalizedPath(configured)
    ) {
      fail("CALL_OUTCOME_PENDING");
    }
    return {
      configuredPath: configured,
      canonicalPath: canonical,
      stats: after,
    };
  } catch (error: unknown) {
    if (error instanceof PreflightError) {
      throw error;
    }
    fail("CALL_OUTCOME_PENDING");
  }
}

async function verifyDirectory(
  snapshot: DirectorySnapshot,
): Promise<DirectorySnapshot> {
  const current = await readDirectorySnapshot(snapshot.configuredPath);
  if (
    normalizedPath(current.canonicalPath) !==
      normalizedPath(snapshot.canonicalPath) ||
    !sameIdentity(current.stats, snapshot.stats)
  ) {
    fail("CALL_OUTCOME_PENDING");
  }
  return current;
}

async function establishChildDirectory(
  parent: DirectorySnapshot,
  name: string,
): Promise<DirectorySnapshot> {
  await verifyDirectory(parent);
  const child = resolve(parent.canonicalPath, name);
  requireContained(parent.canonicalPath, child);
  try {
    await mkdir(child, { mode: 0o700 });
  } catch (error: unknown) {
    if (!isNodeError(error, "EEXIST")) {
      fail("CALL_OUTCOME_PENDING");
    }
  }
  const snapshot = await readDirectorySnapshot(child);
  requireContained(parent.canonicalPath, snapshot.canonicalPath);
  await verifyDirectory(parent);
  return snapshot;
}

type PrivateSession = {
  repository: DirectorySnapshot;
  temporary: DirectorySnapshot;
  privateRoot: DirectorySnapshot;
  session: DirectorySnapshot;
  runs: DirectorySnapshot;
};

async function establishPrivateSession(runId: string): Promise<PrivateSession> {
  if (!SAFE_RUN_ID.test(runId)) {
    fail("CALL_OUTCOME_PENDING");
  }
  const repository = await readDirectorySnapshot(REPOSITORY_ROOT);
  const temporary = await establishChildDirectory(repository, "tmp");
  const privateRoot = await establishChildDirectory(
    temporary,
    "preflight-private",
  );
  const session = await establishChildDirectory(privateRoot, runId);
  const runs = await establishChildDirectory(session, "runs");
  return { repository, temporary, privateRoot, session, runs };
}

async function verifyPrivateSession(session: PrivateSession): Promise<void> {
  const repository = await verifyDirectory(session.repository);
  const temporary = await verifyDirectory(session.temporary);
  const privateRoot = await verifyDirectory(session.privateRoot);
  const runSession = await verifyDirectory(session.session);
  const runs = await verifyDirectory(session.runs);
  requireContained(repository.canonicalPath, temporary.canonicalPath);
  requireContained(temporary.canonicalPath, privateRoot.canonicalPath);
  requireContained(privateRoot.canonicalPath, runSession.canonicalPath);
  requireContained(runSession.canonicalPath, runs.canonicalPath);
}

async function collectEvents(
  calle: CalleClient,
  callId: string,
): Promise<CalleEventPage["events"]> {
  const events: CalleEventPage["events"][number][] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const result = await calle.listEvents(callId, cursor);
    events.push(...result.events);
    if (result.nextCursor === null) {
      return events;
    }
    cursor = result.nextCursor;
  }
  fail("CALL_OUTCOME_PENDING");
}

async function executeLivePreflight(input: PreflightExecutionInput): Promise<{
  result: PreflightExecutionResult;
  privateSession: PrivateSession;
}> {
  const runId = `preflight-${input.scenario}-${randomUUID().replaceAll("-", "")}`;
  const privateSession = await establishPrivateSession(runId);
  const store = new FileRunStore({
    root: privateSession.runs.canonicalPath,
    clock: systemClock,
  });
  const calle = new CalleClient({
    apiKey: input.apiKey,
    baseUrl: CALLE_BASE_URL,
    fetch,
    sleep: (milliseconds) => systemClock.sleep(milliseconds),
  });
  const draft = await createRun(
    {
      store,
      clock: systemClock,
      ids: { next: () => runId },
    },
    {
      order: {
        supplierName: "Northstar Components",
        purchaseOrderRef: "PO-2048",
        expectedQuantity: 500,
        requiredDeliveryDate: "2026-08-15",
      },
      recipient: input.recipient,
    },
  );
  const awaiting = runRecordSchema.parse({
    ...transitionRun(draft, "AWAITING_APPROVAL"),
    updatedAt: systemClock.now(),
  });
  const reviewed = await store.compareAndSwap(
    draft.id,
    draft.version,
    awaiting,
  );
  const authorized = await authorizeRun(
    { store, clock: systemClock },
    {
      runId,
      expectedVersion: reviewed.version,
      approval: {
        runId,
        formRevision: reviewed.version,
        consentToCall: true,
        consentToRecord: true,
        consentToPublish: true,
        supportedRegionConfirmed: true,
        phoneReviewed: true,
        fictionalDataConfirmed: true,
      },
    },
  );
  void authorized;

  let current: RunRecord;
  await verifyPrivateSession(privateSession);
  try {
    current = await startRun({ store, calle, clock: systemClock }, runId);
  } catch (error: unknown) {
    if (!(error instanceof AppError) || error.code !== "CALL_OUTCOME_PENDING") {
      throw error;
    }
    current = runRecordSchema.parse(await store.read(runId));
    if (current.callId === undefined) {
      throw error;
    }
  }
  for (let read = 0; read < MAX_POLL_READS; read += 1) {
    if (
      current.status === "PROVIDER_REPORTED_TERMINAL" ||
      current.status === "OUTCOME_UNKNOWN" ||
      current.status === "FAILED"
    ) {
      break;
    }
    await systemClock.sleep(POLL_DELAY_MILLISECONDS);
    try {
      current = await reconcileRun({ store, calle, clock: systemClock }, runId);
    } catch (error: unknown) {
      if (
        !(error instanceof AppError) ||
        error.code !== "CALL_OUTCOME_PENDING"
      ) {
        throw error;
      }
      current = runRecordSchema.parse(await store.read(runId));
    }
  }

  if (
    current.callId === undefined ||
    current.status === "CALL_STARTING" ||
    current.status === "CALL_IN_PROGRESS" ||
    current.status === "RECONCILING"
  ) {
    fail("CALL_OUTCOME_PENDING");
  }
  if (current.providerSnapshot === undefined) {
    fail("PROVIDER_RESULT_INVALID");
  }
  try {
    validatePreflightEvidenceIntegrity(
      input.scenario,
      current.providerSnapshot,
    );
  } catch {
    fail("PROVIDER_RESULT_INVALID");
  }
  const events = await collectEvents(calle, current.callId);
  return { result: { run: current, events }, privateSession };
}

function sameExactFileState(first: BigIntStats, second: BigIntStats): boolean {
  return (
    sameStableMetadata(first, second) &&
    first.nlink === second.nlink &&
    first.mode === second.mode
  );
}

async function attestExactHandleBytes(
  handle: FileHandle,
  expectedBytes: Buffer,
): Promise<BigIntStats> {
  const before = await handle.stat({ bigint: true });
  if (
    !before.isFile() ||
    before.size !== BigInt(expectedBytes.length) ||
    (before.nlink !== 1n && before.nlink !== 2n)
  ) {
    fail("CALL_OUTCOME_PENDING");
  }

  const attestedBytes = Buffer.alloc(expectedBytes.length + 1);
  let attestedLength = 0;
  while (attestedLength < attestedBytes.length) {
    const read = await handle.read(
      attestedBytes,
      attestedLength,
      attestedBytes.length - attestedLength,
      attestedLength,
    );
    if (read.bytesRead === 0) {
      break;
    }
    attestedLength += read.bytesRead;
  }
  const after = await handle.stat({ bigint: true });
  if (
    attestedLength !== expectedBytes.length ||
    !attestedBytes.subarray(0, attestedLength).equals(expectedBytes) ||
    !sameExactFileState(before, after)
  ) {
    fail("CALL_OUTCOME_PENDING");
  }
  return after;
}

function requireOwnedPath(
  pathStats: BigIntStats,
  ownedStats: BigIntStats,
  expectedLinks: bigint,
): void {
  if (
    !pathStats.isFile() ||
    pathStats.isSymbolicLink() ||
    !sameIdentity(pathStats, ownedStats) ||
    pathStats.nlink !== expectedLinks
  ) {
    fail("CALL_OUTCOME_PENDING");
  }
}

async function unlinkFreshOwnedPath(
  session: PrivateSession,
  path: string,
  ownedStats: BigIntStats,
  expectedLinks: bigint,
): Promise<boolean> {
  try {
    await verifyPrivateSession(session);
    const pathStats = await lstat(path, { bigint: true });
    requireOwnedPath(pathStats, ownedStats, expectedLinks);
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function writePrivateEvidence(
  result: PreflightExecutionResult,
  session: PrivateSession,
): Promise<void> {
  let serialized: string;
  try {
    serialized = `${JSON.stringify(result, null, 2)}\n`;
  } catch {
    fail("CALL_OUTCOME_PENDING");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PRIVATE_EVIDENCE_BYTES) {
    fail("CALL_OUTCOME_PENDING");
  }

  const serializedBytes = Buffer.from(serialized, "utf8");
  const sessionRoot = session.session.canonicalPath;
  const finalPath = resolve(sessionRoot, "result.json");
  const temporaryPath = resolve(
    sessionRoot,
    `.result-${randomUUID().replaceAll("-", "")}.tmp`,
  );
  requireContained(sessionRoot, finalPath);
  requireContained(sessionRoot, temporaryPath);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let ownedFile: BigIntStats | undefined;
  let finalLinked = false;
  let commitUnlinkAttempted = false;
  let handleClosed = false;
  let operationError: unknown;
  try {
    await verifyPrivateSession(session);
    handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | NO_FOLLOW,
      0o600,
    );
    await verifyPrivateSession(session);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    const opened = await attestExactHandleBytes(handle, serializedBytes);
    ownedFile = opened;
    const temporaryBeforeLink = await lstat(temporaryPath, { bigint: true });
    if (
      !opened.isFile() ||
      !temporaryBeforeLink.isFile() ||
      temporaryBeforeLink.isSymbolicLink() ||
      opened.nlink !== 1n ||
      temporaryBeforeLink.nlink !== 1n ||
      opened.size !== BigInt(serializedBytes.length) ||
      !sameStableMetadata(opened, temporaryBeforeLink)
    ) {
      fail("CALL_OUTCOME_PENDING");
    }

    await verifyPrivateSession(session);
    await link(temporaryPath, finalPath);
    finalLinked = true;
    await verifyPrivateSession(session);

    const afterLink = await attestExactHandleBytes(handle, serializedBytes);
    const temporaryAfterLink = await lstat(temporaryPath, { bigint: true });
    const finalAfterLink = await lstat(finalPath, { bigint: true });
    if (
      !afterLink.isFile() ||
      !temporaryAfterLink.isFile() ||
      temporaryAfterLink.isSymbolicLink() ||
      !finalAfterLink.isFile() ||
      finalAfterLink.isSymbolicLink() ||
      afterLink.nlink !== 2n ||
      temporaryAfterLink.nlink !== 2n ||
      finalAfterLink.nlink !== 2n ||
      !sameIdentity(opened, afterLink) ||
      opened.size !== afterLink.size ||
      opened.mtimeNs !== afterLink.mtimeNs ||
      !sameStableMetadata(afterLink, temporaryAfterLink) ||
      !sameStableMetadata(afterLink, finalAfterLink)
    ) {
      fail("CALL_OUTCOME_PENDING");
    }
    ownedFile = afterLink;

    await verifyPrivateSession(session);
    const beforeCommit = await attestExactHandleBytes(handle, serializedBytes);
    const temporaryBeforeCommit = await lstat(temporaryPath, { bigint: true });
    const finalBeforeCommit = await lstat(finalPath, { bigint: true });
    if (
      !sameExactFileState(afterLink, beforeCommit) ||
      !sameExactFileState(beforeCommit, temporaryBeforeCommit) ||
      !sameExactFileState(beforeCommit, finalBeforeCommit)
    ) {
      fail("CALL_OUTCOME_PENDING");
    }
    ownedFile = beforeCommit;
  } catch (error: unknown) {
    operationError = error;
  }

  if (handle !== undefined) {
    try {
      await handle.close();
      handleClosed = true;
    } catch (error: unknown) {
      operationError ??= error;
    }
  }

  if (operationError === undefined) {
    try {
      await verifyPrivateSession(session);
      if (ownedFile === undefined) {
        fail("CALL_OUTCOME_PENDING");
      }
      const temporaryImmediatelyBeforeCommit = await lstat(temporaryPath, {
        bigint: true,
      });
      const finalImmediatelyBeforeCommit = await lstat(finalPath, {
        bigint: true,
      });
      if (
        !sameExactFileState(ownedFile, temporaryImmediatelyBeforeCommit) ||
        !sameExactFileState(ownedFile, finalImmediatelyBeforeCommit)
      ) {
        fail("CALL_OUTCOME_PENDING");
      }
      commitUnlinkAttempted = true;
      await unlink(temporaryPath);
      return;
    } catch (error: unknown) {
      operationError = error;
    }
  }

  if (commitUnlinkAttempted) {
    fail("CALL_OUTCOME_PENDING");
  }

  if (handleClosed && ownedFile !== undefined) {
    if (finalLinked) {
      const finalDeleted = await unlinkFreshOwnedPath(
        session,
        finalPath,
        ownedFile,
        2n,
      );
      if (finalDeleted) {
        await unlinkFreshOwnedPath(session, temporaryPath, ownedFile, 1n);
      }
    } else {
      await unlinkFreshOwnedPath(session, temporaryPath, ownedFile, 1n);
    }
  }
  void operationError;
  fail("CALL_OUTCOME_PENDING");
}

function createLiveCliPreflightProcess() {
  const run = createPreflightProcess();
  let privateSession: PrivateSession | undefined;
  return async (): Promise<PreflightSummary> =>
    run({
      argv: process.argv.slice(2),
      env: process.env,
      isInteractive:
        process.stdin.isTTY === true && process.stdout.isTTY === true,
      prompt: promptOperator,
      writeOutput: (message) => process.stdout.write(`${message}\n`),
      execute: async (executionInput) => {
        const execution = await executeLivePreflight(executionInput);
        privateSession = execution.privateSession;
        return execution.result;
      },
      writePrivateEvidence: async (result) => {
        if (privateSession === undefined) {
          fail("CALL_OUTCOME_PENDING");
        }
        await writePrivateEvidence(result, privateSession);
      },
    });
}

export async function runCliPreflight(): Promise<void> {
  const run = createLiveCliPreflightProcess();
  await run();
}

async function promptOperator(question: string): Promise<string> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  runCliPreflight().catch((error: unknown) => {
    const code =
      error instanceof PreflightError ||
      (error instanceof AppError && error.code === "PROVIDER_RESULT_INVALID")
        ? error.code
        : "CALL_OUTCOME_PENDING";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
