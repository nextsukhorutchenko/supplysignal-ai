import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { z } from "zod";

import { CalleClient } from "../src/adapters/calle/client.js";
import { FileRunStore } from "../src/adapters/filesystem/run-store.js";
import { authorizeRun } from "../src/application/authorize-run.js";
import { createRun } from "../src/application/create-run.js";
import type {
  CalleEventPage,
  Clock,
  IdGenerator,
} from "../src/application/ports.js";
import { reconcileRun } from "../src/application/reconcile-run.js";
import { startRun } from "../src/application/start-run.js";
import { createCallRecipient } from "../src/domain/call-recipient.js";
import { AppError } from "../src/domain/errors.js";
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

const scenarioSchema = z.enum(["answered", "declined", "no_answer"]);

export type PreflightScenario = z.infer<typeof scenarioSchema>;

export type PreflightExecutionInput = {
  scenario: PreflightScenario;
  phone: string;
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
  status: RunRecord["status"];
  providerStatus: ProviderEvidenceSnapshot["status"] | "not_available";
  eventCount: number;
};

type PermitState = "available" | "reserved" | "consumed";

let permitState: PermitState = "available";

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
  phone: string;
  maskedPhone: string;
} {
  const apiKey = env.CALLE_API_KEY;
  const phone = env.SUPPLIER_TEST_PHONE;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    fail("PREFLIGHT_CONFIGURATION_REQUIRED");
  }
  if (typeof phone !== "string" || phone.length === 0) {
    fail("PREFLIGHT_CONFIGURATION_REQUIRED");
  }
  try {
    const recipient = createCallRecipient({
      recipientName: "Consenting participant",
      phoneE164: phone,
      region: "US",
      locale: "en-US",
    });
    return {
      apiKey,
      phone: recipient.phoneE164,
      maskedPhone: recipient.maskedPhone,
    };
  } catch {
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
    if (permitState !== "available") {
      fail("PREFLIGHT_CALL_LIMIT_REACHED");
    }
    permitState = "reserved";

    try {
      input.writeOutput(
        `Scenario: ${scenario}\nRecipient: ${configuration.maskedPhone}`,
      );
      const confirmation = await input.prompt(`Type ${AUTHORIZATION_PHRASE}: `);
      if (confirmation !== AUTHORIZATION_PHRASE) {
        fail("AUTHORIZATION_REQUIRED");
      }
    } catch (error: unknown) {
      if (permitState === "reserved") {
        permitState = "available";
      }
      throw error;
    }

    permitState = "consumed";
    const result = await input.execute({
      scenario,
      phone: configuration.phone,
      apiKey: configuration.apiKey,
    });
    await input.writePrivateEvidence(result);
    const summary: PreflightSummary = {
      scenario,
      maskedPhone: configuration.maskedPhone,
      status: result.run.status,
      providerStatus: result.run.providerSnapshot?.status ?? "not_available",
      eventCount: result.events.length,
    };
    input.writeOutput(JSON.stringify(summary));
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

async function attestExistingDirectory(path: string): Promise<string> {
  try {
    const configured = resolve(path);
    const before = await lstat(configured);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail("CALL_OUTCOME_PENDING");
    }
    const canonical = await realpath(configured);
    const after = await lstat(configured);
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      normalizedPath(canonical) !== normalizedPath(configured)
    ) {
      fail("CALL_OUTCOME_PENDING");
    }
    return canonical;
  } catch (error: unknown) {
    if (error instanceof PreflightError) {
      throw error;
    }
    fail("CALL_OUTCOME_PENDING");
  }
}

async function establishChildDirectory(
  parent: string,
  name: string,
): Promise<string> {
  const child = resolve(parent, name);
  requireContained(parent, child);
  try {
    await mkdir(child, { mode: 0o700 });
  } catch (error: unknown) {
    if (!isNodeError(error, "EEXIST")) {
      fail("CALL_OUTCOME_PENDING");
    }
  }
  const canonical = await attestExistingDirectory(child);
  requireContained(parent, canonical);
  return canonical;
}

type PrivateSession = {
  root: string;
  runs: string;
};

async function establishPrivateSession(runId: string): Promise<PrivateSession> {
  if (!SAFE_RUN_ID.test(runId)) {
    fail("CALL_OUTCOME_PENDING");
  }
  const repository = await attestExistingDirectory(REPOSITORY_ROOT);
  const temporary = await establishChildDirectory(repository, "tmp");
  const privateDirectory = await establishChildDirectory(
    temporary,
    "preflight-private",
  );
  const session = await establishChildDirectory(privateDirectory, runId);
  const runs = await establishChildDirectory(session, "runs");
  return { root: session, runs };
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

export type LivePreflightRuntimeOptions = {
  fetchImpl: typeof fetch;
  clock: Clock;
  ids?: IdGenerator;
};

export async function executeLivePreflight(
  input: PreflightExecutionInput,
  options: LivePreflightRuntimeOptions,
): Promise<PreflightExecutionResult> {
  const runId =
    options.ids?.next() ??
    `preflight-${input.scenario}-${randomUUID().replaceAll("-", "")}`;
  const privateSession = await establishPrivateSession(runId);
  const store = new FileRunStore({
    root: privateSession.runs,
    clock: options.clock,
  });
  const calle = new CalleClient({
    apiKey: input.apiKey,
    baseUrl: CALLE_BASE_URL,
    fetch: options.fetchImpl,
    sleep: (milliseconds) => options.clock.sleep(milliseconds),
  });
  const draft = await createRun(
    {
      store,
      clock: options.clock,
      ids: { next: () => runId },
    },
    {
      order: {
        supplierName: "Northstar Components",
        purchaseOrderRef: "PO-2048",
        expectedQuantity: 500,
        requiredDeliveryDate: "2026-08-15",
      },
      recipient: {
        recipientName: "Consenting participant",
        phoneE164: input.phone,
        region: "US",
        locale: "en-US",
      },
    },
  );
  const awaiting = runRecordSchema.parse({
    ...transitionRun(draft, "AWAITING_APPROVAL"),
    updatedAt: options.clock.now(),
  });
  const reviewed = await store.compareAndSwap(
    draft.id,
    draft.version,
    awaiting,
  );
  const authorized = await authorizeRun(
    { store, clock: options.clock },
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
  try {
    current = await startRun({ store, calle, clock: options.clock }, runId);
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
    await options.clock.sleep(POLL_DELAY_MILLISECONDS);
    try {
      current = await reconcileRun(
        { store, calle, clock: options.clock },
        runId,
      );
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
  const events = await collectEvents(calle, current.callId);
  return { run: current, events };
}

export async function writePrivateEvidence(
  result: PreflightExecutionResult,
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

  const session = await establishPrivateSession(result.run.id);
  const finalPath = resolve(session.root, "result.json");
  const temporaryPath = resolve(
    session.root,
    `.result-${randomUUID().replaceAll("-", "")}.tmp`,
  );
  requireContained(session.root, finalPath);
  requireContained(session.root, temporaryPath);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath).catch(() => undefined);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    fail("CALL_OUTCOME_PENDING");
  }
}

export type CliPreflightProcessInput = Pick<
  PreflightProcessInput,
  "argv" | "env" | "isInteractive" | "prompt" | "writeOutput"
>;

export function createCliPreflightProcess(
  options: LivePreflightRuntimeOptions = {
    fetchImpl: fetch,
    clock: systemClock,
  },
) {
  const run = createPreflightProcess();
  return async (input: CliPreflightProcessInput): Promise<PreflightSummary> =>
    run({
      ...input,
      execute: (executionInput) =>
        executeLivePreflight(executionInput, options),
      writePrivateEvidence,
    });
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

async function main(): Promise<void> {
  const run = createCliPreflightProcess();
  await run({
    argv: process.argv.slice(2),
    env: process.env,
    isInteractive:
      process.stdin.isTTY === true && process.stdout.isTTY === true,
    prompt: promptOperator,
    writeOutput: (message) => process.stdout.write(`${message}\n`),
  });
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  main().catch((error: unknown) => {
    const code =
      error instanceof PreflightError ? error.code : "CALL_OUTCOME_PENDING";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
