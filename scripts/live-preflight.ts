import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { z } from "zod";

import { CalleClient } from "../src/adapters/calle/client.js";
import { FileRunStore } from "../src/adapters/filesystem/run-store.js";
import { authorizeRun } from "../src/application/authorize-run.js";
import { createRun } from "../src/application/create-run.js";
import type { CalleEventPage, Clock } from "../src/application/ports.js";
import { reconcileRun } from "../src/application/reconcile-run.js";
import { startRun } from "../src/application/start-run.js";
import { createCallRecipient } from "../src/domain/call-recipient.js";
import {
  runRecordSchema,
  transitionRun,
  type ProviderEvidenceSnapshot,
  type RunRecord,
} from "../src/domain/run.js";

const AUTHORIZATION_PHRASE = "AUTHORIZE ONE CALL";
const PRIVATE_ROOT = resolve("tmp", "preflight-private");
const CALLE_BASE_URL = "https://api.heycall-e.com";
const POLL_DELAY_MILLISECONDS = 5_000;
const MAX_POLL_READS = 60;
const MAX_EVENT_PAGES = 10;

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
  let callExecutionStarted = false;

  return async function runPreflight(
    input: PreflightProcessInput,
  ): Promise<PreflightSummary> {
    const scenario = parseScenario(input.argv);
    const configuration = requireConfiguration(input.env);
    if (!input.isInteractive) {
      fail("PREFLIGHT_INTERACTIVE_REQUIRED");
    }
    if (callExecutionStarted) {
      fail("PREFLIGHT_CALL_LIMIT_REACHED");
    }

    input.writeOutput(
      `Scenario: ${scenario}\nRecipient: ${configuration.maskedPhone}`,
    );
    const confirmation = await input.prompt(`Type ${AUTHORIZATION_PHRASE}: `);
    if (confirmation !== AUTHORIZATION_PHRASE) {
      fail("AUTHORIZATION_REQUIRED");
    }

    callExecutionStarted = true;
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
  return events;
}

async function executeLivePreflight(
  input: PreflightExecutionInput,
): Promise<PreflightExecutionResult> {
  const store = new FileRunStore({
    root: resolve(PRIVATE_ROOT, "runs"),
    clock: systemClock,
  });
  const calle = new CalleClient({
    apiKey: input.apiKey,
    baseUrl: CALLE_BASE_URL,
    fetch,
  });
  const runId = `preflight-${input.scenario}-${randomUUID().replaceAll("-", "")}`;
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

  let current = await startRun({ store, calle, clock: systemClock }, runId);
  for (let read = 0; read < MAX_POLL_READS; read += 1) {
    if (
      current.status === "PROVIDER_REPORTED_TERMINAL" ||
      current.status === "OUTCOME_UNKNOWN" ||
      current.status === "FAILED"
    ) {
      break;
    }
    await systemClock.sleep(POLL_DELAY_MILLISECONDS);
    current = await reconcileRun({ store, calle, clock: systemClock }, runId);
  }

  if (current.callId === undefined) {
    fail("CALL_OUTCOME_PENDING");
  }
  const events = await collectEvents(calle, current.callId);
  return { run: current, events };
}

async function writePrivateEvidence(
  result: PreflightExecutionResult,
): Promise<void> {
  await mkdir(PRIVATE_ROOT, { recursive: true });
  const fileName = `${result.run.id}.result.json`;
  await writeFile(
    resolve(PRIVATE_ROOT, fileName),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
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
  const run = createPreflightProcess();
  await run({
    argv: process.argv.slice(2),
    env: process.env,
    isInteractive:
      process.stdin.isTTY === true && process.stdout.isTTY === true,
    prompt: promptOperator,
    execute: executeLivePreflight,
    writePrivateEvidence,
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
