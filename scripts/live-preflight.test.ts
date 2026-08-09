import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../src/application/ports.js";
import type { RunRecord } from "../src/domain/run.js";
import type {
  PreflightExecutionInput,
  PreflightExecutionResult,
  PreflightProcessInput,
} from "./live-preflight.js";

const apiKey = "server-only-test-token";
const phone = ["+1", "202", "555", "0147"].join("");
const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(scriptsDirectory, "..");
const privateRoot = resolve(repositoryRoot, "tmp", "preflight-private");

type PreflightModule = typeof import("./live-preflight.js");

async function freshModule(): Promise<PreflightModule> {
  vi.resetModules();
  return import("./live-preflight.js");
}

function terminalRun(input: PreflightExecutionInput): PreflightExecutionResult {
  const run: RunRecord = {
    id: `preflight_${input.scenario}`,
    version: 4,
    status: "PROVIDER_REPORTED_TERMINAL",
    trustStatus: "UNVERIFIED_PROVIDER_RESULT",
    order: {
      supplierName: "Northstar Components",
      purchaseOrderRef: "PO-2048",
      expectedQuantity: 500,
      requiredDeliveryDate: "2026-08-15",
    },
    recipient: {
      recipientName: "Consenting participant",
      phoneE164: input.phone,
      maskedPhone: "+1 ***-***-0147",
      region: "US",
      locale: "en-US",
    },
    schemaValidation: "not_run",
    consistencyValidation: "not_run",
    artifactState: "none",
    callId: "call_private_001",
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:01:00.000Z",
  };
  return { run, events: [] };
}

function validInput(
  overrides: Partial<PreflightProcessInput> = {},
): PreflightProcessInput {
  return {
    argv: ["--scenario", "answered"],
    env: { CALLE_API_KEY: apiKey, SUPPLIER_TEST_PHONE: phone },
    isInteractive: true,
    prompt: vi.fn(async () => "AUTHORIZE ONE CALL"),
    execute: vi.fn(async (input: PreflightExecutionInput) =>
      terminalRun(input),
    ),
    writePrivateEvidence: vi.fn(async () => undefined),
    writeOutput: vi.fn(),
    ...overrides,
  };
}

const immediateClock: Clock = {
  now: () => "2026-08-09T10:00:00.000Z",
  sleep: async () => undefined,
};

async function fixture(name: string): Promise<string> {
  return readFile(
    new URL(`../tests/fixtures/calle/${name}`, import.meta.url),
    "utf8",
  );
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function removeSession(runId: string): Promise<void> {
  await rm(resolve(privateRoot, runId), { recursive: true, force: true });
}

function cliInput(
  overrides: Partial<
    Pick<
      PreflightProcessInput,
      "argv" | "env" | "isInteractive" | "prompt" | "writeOutput"
    >
  > = {},
) {
  return {
    argv: ["--scenario", "answered"],
    env: { CALLE_API_KEY: apiKey, SUPPLIER_TEST_PHONE: phone },
    isInteractive: true,
    prompt: vi.fn(async () => "AUTHORIZE ONE CALL"),
    writeOutput: vi.fn<(message: string) => void>(),
    ...overrides,
  };
}

describe("live CALL-E preflight safety boundary", () => {
  it("rejects a missing CALL-E API key before execution", async () => {
    const { createPreflightProcess } = await freshModule();
    const run = createPreflightProcess();
    const input = validInput({ env: { SUPPLIER_TEST_PHONE: phone } });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_CONFIGURATION_REQUIRED",
    });
    expect(input.execute).not.toHaveBeenCalled();
  });

  it("rejects a missing supplier phone before execution", async () => {
    const { createPreflightProcess } = await freshModule();
    const run = createPreflightProcess();
    const input = validInput({ env: { CALLE_API_KEY: apiKey } });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_CONFIGURATION_REQUIRED",
    });
    expect(input.execute).not.toHaveBeenCalled();
  });

  it.each(["+442079460123", "+120255501", "+1202555014x"])(
    "rejects invalid or non-US phone %s before execution",
    async (invalidPhone) => {
      const { createPreflightProcess } = await freshModule();
      const run = createPreflightProcess();
      const writeOutput = vi.fn<(message: string) => void>();
      const input = validInput({
        env: { CALLE_API_KEY: apiKey, SUPPLIER_TEST_PHONE: invalidPhone },
        writeOutput,
      });

      await expect(run(input)).rejects.toMatchObject({
        code: "UNSUPPORTED_RECIPIENT_REGION",
      });
      expect(input.execute).not.toHaveBeenCalled();
      expect(JSON.stringify(writeOutput.mock.calls)).not.toContain(
        invalidPhone,
      );
    },
  );

  it("rejects non-interactive execution before prompting or execution", async () => {
    const { createPreflightProcess } = await freshModule();
    const run = createPreflightProcess();
    const input = validInput({ isInteractive: false });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_INTERACTIVE_REQUIRED",
    });
    expect(input.prompt).not.toHaveBeenCalled();
    expect(input.execute).not.toHaveBeenCalled();
  });

  it.each(["", "authorize one call", "AUTHORIZE ONE CALL "])(
    "rejects non-exact authorization phrase %j and releases the reservation",
    async (confirmation) => {
      const { createPreflightProcess } = await freshModule();
      const first = createPreflightProcess();
      const rejected = validInput({
        prompt: vi.fn(async () => confirmation),
      });

      await expect(first(rejected)).rejects.toMatchObject({
        code: "AUTHORIZATION_REQUIRED",
      });
      expect(rejected.execute).not.toHaveBeenCalled();

      const second = validInput();
      await expect(createPreflightProcess()(second)).resolves.toMatchObject({
        status: "PROVIDER_REPORTED_TERMINAL",
      });
      expect(second.execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { argv: [] },
    { argv: ["--scenario", "unexpected"] },
    { argv: ["--scenario", "answered", "--scenario", "declined"] },
    { argv: ["--scenario", "answered", "--phone", phone] },
  ])("rejects invalid or ambiguous arguments $argv", async ({ argv }) => {
    const { createPreflightProcess } = await freshModule();
    const run = createPreflightProcess();
    const input = validInput({ argv });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_SCENARIO_INVALID",
    });
    expect(input.execute).not.toHaveBeenCalled();
  });

  it("atomically blocks concurrent execution on the same runner", async () => {
    const { createPreflightProcess } = await freshModule();
    let authorize: ((value: string) => void) | undefined;
    const prompt = vi.fn(
      async () =>
        new Promise<string>((resolvePrompt) => {
          authorize = resolvePrompt;
        }),
    );
    const execute = vi.fn(async (input: PreflightExecutionInput) =>
      terminalRun(input),
    );
    const run = createPreflightProcess();
    const first = run(validInput({ prompt, execute }));

    await expect(run(validInput({ execute }))).rejects.toMatchObject({
      code: "PREFLIGHT_CALL_LIMIT_REACHED",
    });
    authorize?.("AUTHORIZE ONE CALL");
    await expect(first).resolves.toMatchObject({
      status: "PROVIDER_REPORTED_TERMINAL",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("shares one atomic execution permit across factory instances", async () => {
    const { createPreflightProcess } = await freshModule();
    let authorize: ((value: string) => void) | undefined;
    const prompt = vi.fn(
      async () =>
        new Promise<string>((resolvePrompt) => {
          authorize = resolvePrompt;
        }),
    );
    const execute = vi.fn(async (input: PreflightExecutionInput) =>
      terminalRun(input),
    );
    const first = createPreflightProcess()(validInput({ prompt, execute }));

    await expect(
      createPreflightProcess()(validInput({ execute })),
    ).rejects.toMatchObject({ code: "PREFLIGHT_CALL_LIMIT_REACHED" });
    authorize?.("AUTHORIZE ONE CALL");
    await expect(first).resolves.toMatchObject({
      status: "PROVIDER_REPORTED_TERMINAL",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("permanently consumes the permit once provider execution begins", async () => {
    const { createPreflightProcess } = await freshModule();
    const execute = vi.fn(async () => Promise.reject(new Error("bounded")));

    await expect(
      createPreflightProcess()(validInput({ execute })),
    ).rejects.toThrow();
    await expect(createPreflightProcess()(validInput())).rejects.toMatchObject({
      code: "PREFLIGHT_CALL_LIMIT_REACHED",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("prints only the scenario, masked phone, and sanitized result", async () => {
    const { createPreflightProcess } = await freshModule();
    const run = createPreflightProcess();
    const writeOutput = vi.fn<(message: string) => void>();
    const input = validInput({ writeOutput });

    await run(input);

    const output = JSON.stringify(writeOutput.mock.calls);
    expect(output).toContain("answered");
    expect(output).toContain("+1 ***-***-0147");
    expect(output).toContain("PROVIDER_REPORTED_TERMINAL");
    expect(output).not.toContain(phone);
    expect(output).not.toContain(apiKey);
    expect(output).not.toContain("call_private_001");
    expect(input.writePrivateEvidence).toHaveBeenCalledTimes(1);
  });
});

describe("actual offline CLI composition", () => {
  it("fails missing configuration with zero provider POSTs and no evidence", async () => {
    const { createCliPreflightProcess } = await freshModule();
    const fetchMock = vi.fn<typeof fetch>();
    const runId = "preflight-missing-config";
    await removeSession(runId);
    const run = createCliPreflightProcess({
      fetchImpl: fetchMock,
      clock: immediateClock,
      ids: { next: () => runId },
    });

    await expect(
      run(cliInput({ env: { SUPPLIER_TEST_PHONE: phone } })),
    ).rejects.toMatchObject({ code: "PREFLIGHT_CONFIGURATION_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readdir(resolve(privateRoot, runId))).rejects.toThrow();
  });

  it("uses the corrected lifecycle and actual writer from an alternate CWD with one POST", async () => {
    const { createCliPreflightProcess } = await freshModule();
    const runId = "preflight-actual-composition";
    await removeSession(runId);
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(await fixture("create-accepted.json"), 201);
      }
      if (String(url).endsWith("/events")) {
        return jsonResponse(await fixture("events-page.json"));
      }
      return jsonResponse(await fixture("completed-valid.json"));
    });
    const run = createCliPreflightProcess({
      fetchImpl: fetchMock,
      clock: immediateClock,
      ids: { next: () => runId },
    });
    const outside = await mkdtemp(resolve(tmpdir(), "supplysignal-preflight-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(outside);
      const writeOutput = vi.fn<(message: string) => void>();
      const input = cliInput({ writeOutput });
      await expect(run(input)).resolves.toMatchObject({
        status: "PROVIDER_REPORTED_TERMINAL",
        providerStatus: "completed",
      });
      const posts = fetchMock.mock.calls.filter(
        ([, request]) => request?.method === "POST",
      );
      expect(posts).toHaveLength(1);
      const privateEvidence = await readFile(
        resolve(privateRoot, runId, "result.json"),
        "utf8",
      );
      expect(privateEvidence).toContain(
        '"status": "PROVIDER_REPORTED_TERMINAL"',
      );
      expect(privateEvidence).toContain(phone);
      expect(JSON.stringify(writeOutput.mock.calls)).not.toContain(phone);
      await expect(readdir(resolve(outside, "tmp"))).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await removeSession(runId);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns bounded pending after polling remains active and issues one POST", async () => {
    const { createCliPreflightProcess } = await freshModule();
    const runId = "preflight-poll-exhaustion";
    await removeSession(runId);
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === "POST"
        ? jsonResponse(await fixture("create-accepted.json"), 201)
        : jsonResponse(await fixture("in-progress.json")),
    );
    const writeOutput = vi.fn<(message: string) => void>();
    const input = cliInput({ writeOutput });
    const run = createCliPreflightProcess({
      fetchImpl: fetchMock,
      clock: immediateClock,
      ids: { next: () => runId },
    });

    try {
      await expect(run(input)).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
      });
      expect(
        fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(writeOutput.mock.calls)).not.toContain('"status"');
      await expect(
        readFile(resolve(privateRoot, runId, "result.json")),
      ).rejects.toThrow();
    } finally {
      await removeSession(runId);
    }
  }, 15_000);

  it("fails bounded when event pagination remains incomplete after the limit", async () => {
    const { createCliPreflightProcess } = await freshModule();
    const runId = "preflight-event-limit";
    await removeSession(runId);
    const continuedEvents = JSON.parse(
      await fixture("events-page.json"),
    ) as Record<string, unknown>;
    continuedEvents.next_cursor = "cursor_more";
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(await fixture("create-accepted.json"), 201);
      }
      if (String(url).includes("/events")) {
        return jsonResponse(JSON.stringify(continuedEvents));
      }
      return jsonResponse(await fixture("completed-valid.json"));
    });
    const writeOutput = vi.fn<(message: string) => void>();
    const input = cliInput({ writeOutput });
    const run = createCliPreflightProcess({
      fetchImpl: fetchMock,
      clock: immediateClock,
      ids: { next: () => runId },
    });

    try {
      await expect(run(input)).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
      });
      expect(
        fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(writeOutput.mock.calls)).not.toContain(
        '"eventCount"',
      );
    } finally {
      await removeSession(runId);
    }
  });

  it("rejects a redirected private session before any provider POST", async (context) => {
    const { createCliPreflightProcess } = await freshModule();
    const runId = "preflight-redirected-session";
    const session = resolve(privateRoot, runId);
    const outside = await mkdtemp(resolve(tmpdir(), "supplysignal-redirect-"));
    await removeSession(runId);
    await mkdir(privateRoot, { recursive: true });
    try {
      await symlink(
        outside,
        session,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error: unknown) {
      await rm(outside, { recursive: true, force: true });
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        context.skip();
        return;
      }
      throw error;
    }
    const fetchMock = vi.fn<typeof fetch>();
    const run = createCliPreflightProcess({
      fetchImpl: fetchMock,
      clock: immediateClock,
      ids: { next: () => runId },
    });

    try {
      await expect(run(cliInput())).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(session, { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("publishes bounded private evidence create-only without partial authority", async () => {
    const { writePrivateEvidence } = await freshModule();
    const runId = "preflight-writer-boundary";
    await removeSession(runId);
    const result = terminalRun({ scenario: "answered", phone, apiKey });
    result.run.id = runId;

    try {
      await writePrivateEvidence(result);
      const first = await readFile(
        resolve(privateRoot, runId, "result.json"),
        "utf8",
      );
      await expect(writePrivateEvidence(result)).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
      });
      expect(
        await readFile(resolve(privateRoot, runId, "result.json"), "utf8"),
      ).toBe(first);

      const oversized = structuredClone(result);
      oversized.run.id = `${runId}-oversized`;
      oversized.events = [
        {
          id: "event_oversized",
          type: "test",
          occurredAt: "2026-08-09T10:00:00.000Z",
          summary: "x".repeat(1_048_577),
        },
      ];
      await expect(writePrivateEvidence(oversized)).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
      });
      await expect(
        readFile(resolve(privateRoot, `${runId}-oversized`, "result.json")),
      ).rejects.toThrow();
      await removeSession(`${runId}-oversized`);
    } finally {
      await removeSession(runId);
    }
  });
});
