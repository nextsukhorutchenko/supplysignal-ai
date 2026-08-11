import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { RunRecord } from "../src/domain/run.js";
import type {
  PreflightExecutionInput,
  PreflightExecutionResult,
  PreflightProcessInput,
} from "./live-preflight.js";

const apiKey = "server-only-test-token";
const phone = ["+1", "202", "555", "0147"].join("");
const kenyaPhone = ["+254", "100", "000", "000"].join("");
const ukrainePhone = ["+380", "100", "000", "000"].join("");
const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(scriptsDirectory, "..");
const privateRoot = resolve(repositoryRoot, "tmp", "preflight-private");

type PreflightModule = typeof import("./live-preflight.js");

function resetPreflightModuleContext(): void {
  vi.resetModules();
  vi.doUnmock("node:process");
  const isolatedProcess = Object.create(process) as NodeJS.Process;
  vi.doMock("node:process", () => ({ default: isolatedProcess }));
}

async function freshModule(): Promise<PreflightModule> {
  resetPreflightModuleContext();
  return import("./live-preflight.js");
}

async function queryModule(query: string): Promise<PreflightModule> {
  const specifier = `./live-preflight.js?${query}`;
  return (await import(/* @vite-ignore */ specifier)) as PreflightModule;
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
    recipient: { ...input.recipient },
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

const runUuid = "11111111-1111-4111-8111-111111111111";
const temporaryUuid = "22222222-2222-4222-8222-222222222222";
const guardedRunId = `preflight-answered-${runUuid.replaceAll("-", "")}`;

type GuardedCliOptions = {
  apiKey?: string;
  phone?: string;
  language?: string;
  phrase?: string;
  interactive?: boolean;
  fetchMock?: typeof fetch;
  mockFileSystem?: (
    actual: typeof import("node:fs/promises"),
  ) => Partial<typeof import("node:fs/promises")>;
};

type GuardedCliResult = {
  error: unknown;
  output: string;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  promptMock: ReturnType<typeof vi.fn>;
};

async function runGuardedCli(
  options: GuardedCliOptions = {},
): Promise<GuardedCliResult> {
  resetPreflightModuleContext();
  vi.doUnmock("node:crypto");
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("node:readline/promises");
  vi.doMock("node:crypto", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:crypto")>();
    const uuids = [runUuid, temporaryUuid];
    return {
      ...actual,
      randomUUID: vi.fn(() => uuids.shift() ?? temporaryUuid),
    };
  });
  const promptMock = vi.fn(async () => options.phrase ?? "AUTHORIZE ONE CALL");
  vi.doMock("node:readline/promises", () => ({
    createInterface: () => ({
      question: promptMock,
      close: vi.fn(),
    }),
  }));
  if (options.mockFileSystem !== undefined) {
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return { ...actual, ...options.mockFileSystem?.(actual) };
    });
  }

  const fetchMock = vi.fn<typeof fetch>(
    options.fetchMock ??
      (async (url, init) => {
        if (init?.method === "POST") {
          return jsonResponse(await fixture("create-accepted.json"), 201);
        }
        if (String(url).endsWith("/events")) {
          return jsonResponse(await fixture("events-page.json"));
        }
        return jsonResponse(await fixture("completed-valid.json"));
      }),
  );
  const originalArgv = process.argv;
  const originalApiKey = process.env.CALLE_API_KEY;
  const originalPhone = process.env.SUPPLIER_TEST_PHONE;
  const originalLanguage = process.env.SUPPLIER_TEST_LANGUAGE;
  const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const output: string[] = [];
  const outputSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...arguments_: unknown[]) => void,
  ) => {
    queueMicrotask(callback);
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);

  process.argv = [
    process.execPath,
    "guarded-cli-test",
    "--scenario",
    "answered",
  ];
  if (options.apiKey === undefined) {
    delete process.env.CALLE_API_KEY;
  } else {
    process.env.CALLE_API_KEY = options.apiKey;
  }
  if (options.phone === undefined) {
    delete process.env.SUPPLIER_TEST_PHONE;
  } else {
    process.env.SUPPLIER_TEST_PHONE = options.phone;
  }
  if (options.language === undefined) {
    delete process.env.SUPPLIER_TEST_LANGUAGE;
  } else {
    process.env.SUPPLIER_TEST_LANGUAGE = options.language;
  }
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: options.interactive ?? true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: options.interactive ?? true,
  });
  vi.stubGlobal("fetch", fetchMock);

  let error: unknown;
  try {
    const preflightModule = await import("./live-preflight.js");
    await preflightModule.runCliPreflight();
  } catch (caught: unknown) {
    error = caught;
  } finally {
    process.argv = originalArgv;
    if (originalApiKey === undefined) {
      delete process.env.CALLE_API_KEY;
    } else {
      process.env.CALLE_API_KEY = originalApiKey;
    }
    if (originalPhone === undefined) {
      delete process.env.SUPPLIER_TEST_PHONE;
    } else {
      process.env.SUPPLIER_TEST_PHONE = originalPhone;
    }
    if (originalLanguage === undefined) {
      delete process.env.SUPPLIER_TEST_LANGUAGE;
    } else {
      process.env.SUPPLIER_TEST_LANGUAGE = originalLanguage;
    }
    if (stdinTty === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdin, "isTTY", stdinTty);
    }
    if (stdoutTty === undefined) {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    }
    outputSpy.mockRestore();
    timeoutSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.doUnmock("node:crypto");
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:process");
    vi.doUnmock("node:readline/promises");
    vi.resetModules();
  }
  return { error, output: output.join(""), fetchMock, promptMock };
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

  it.each([
    ["unsupported country", ["+44", "20", "7946", "0123"].join("")],
    ["malformed US length", ["+1", "202", "555", "01"].join("")],
    ["malformed US extension", ["+1", "202", "555", "0147", "x1"].join("")],
    ["malformed Kenya zero prefix", ["+254", "000", "000", "000"].join("")],
    ["malformed Kenya length", ["+254", "100", "000", "00"].join("")],
    ["malformed Kenya local format", ["07", "00", "000", "000"].join("")],
  ])(
    "rejects %s before prompting or execution",
    async (_case, invalidPhone) => {
      const { createPreflightProcess } = await freshModule();
      const run = createPreflightProcess();
      const writeOutput = vi.fn<(message: string) => void>();
      const prompt = vi.fn(async () => "AUTHORIZE ONE CALL");
      const input = validInput({
        env: { CALLE_API_KEY: apiKey, SUPPLIER_TEST_PHONE: invalidPhone },
        prompt,
        writeOutput,
      });

      await expect(run(input)).rejects.toMatchObject({
        code: "UNSUPPORTED_RECIPIENT_REGION",
      });
      expect(input.execute).not.toHaveBeenCalled();
      expect(prompt).not.toHaveBeenCalled();
      expect(JSON.stringify(writeOutput.mock.calls)).not.toContain(
        invalidPhone,
      );
    },
  );

  it.each([
    [undefined, "missing"],
    ["ukrainian", "wrong case"],
    ["Ukrainian ", "padded"],
    ["French", "unsupported"],
  ] as const)(
    "rejects %s Ukraine language before authorization",
    async (language, _case) => {
      void _case;
      const { createPreflightProcess } = await freshModule();
      const run = createPreflightProcess();
      const input = validInput({
        env: {
          CALLE_API_KEY: apiKey,
          SUPPLIER_TEST_PHONE: ukrainePhone,
          ...(language === undefined
            ? {}
            : { SUPPLIER_TEST_LANGUAGE: language }),
        },
      });

      await expect(run(input)).rejects.toMatchObject({
        code: "UNSUPPORTED_RECIPIENT_LANGUAGE",
      });
      expect(input.prompt).not.toHaveBeenCalled();
      expect(input.execute).not.toHaveBeenCalled();
      expect(input.writePrivateEvidence).not.toHaveBeenCalled();
      expect(
        JSON.stringify(
          (input.writeOutput as ReturnType<typeof vi.fn>).mock.calls,
        ),
      ).not.toContain(language ?? "missing");
    },
  );

  it.each([phone, kenyaPhone])(
    "rejects an extra language for an established recipient before authorization",
    async (recipientPhone) => {
      const { createPreflightProcess } = await freshModule();
      const input = validInput({
        env: {
          CALLE_API_KEY: apiKey,
          SUPPLIER_TEST_PHONE: recipientPhone,
          SUPPLIER_TEST_LANGUAGE: "English",
        },
      });

      await expect(createPreflightProcess()(input)).rejects.toMatchObject({
        code: "UNSUPPORTED_RECIPIENT_LANGUAGE",
      });
      expect(input.prompt).not.toHaveBeenCalled();
      expect(input.execute).not.toHaveBeenCalled();
      expect(input.writePrivateEvidence).not.toHaveBeenCalled();
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

  it("shares one atomic execution permit across distinct ESM module instances", async () => {
    resetPreflightModuleContext();
    const firstModule = await queryModule("permit-a");
    const secondModule = await queryModule("permit-b");
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
    const first = firstModule.createPreflightProcess()(
      validInput({ prompt, execute }),
    );
    const second = secondModule.createPreflightProcess()(
      validInput({ execute }),
    );
    const secondExpectation = expect(second).rejects.toMatchObject({
      code: "PREFLIGHT_CALL_LIMIT_REACHED",
    });

    expect(firstModule).not.toBe(secondModule);
    authorize?.("AUTHORIZE ONE CALL");
    await expect(first).resolves.toMatchObject({
      status: "PROVIDER_REPORTED_TERMINAL",
    });
    await secondExpectation;
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
    expect(output).toContain("United States");
    expect(output).toContain("English");
    expect(output).toContain("PROVIDER_REPORTED_TERMINAL");
    expect(output).not.toContain(phone);
    expect(output).not.toContain(apiKey);
    expect(output).not.toContain("call_private_001");
    expect(input.writePrivateEvidence).toHaveBeenCalledTimes(1);
  });

  it("derives and displays the canonical Kenya English profile", async () => {
    const { createPreflightProcess } = await freshModule();
    const run = createPreflightProcess();
    const execute = vi.fn(async (input: PreflightExecutionInput) =>
      terminalRun(input),
    );
    const writeOutput = vi.fn<(message: string) => void>();
    const input = validInput({
      env: { CALLE_API_KEY: apiKey, SUPPLIER_TEST_PHONE: kenyaPhone },
      execute,
      writeOutput,
    });

    await expect(run(input)).resolves.toMatchObject({
      country: "Kenya",
      language: "English",
      maskedPhone: "+254 ***-**-0000",
    });
    expect(execute).toHaveBeenCalledWith({
      scenario: "answered",
      apiKey,
      recipient: {
        recipientName: "Consenting participant",
        phoneE164: kenyaPhone,
        maskedPhone: "+254 ***-**-0000",
        region: "KE",
        locale: "en-KE",
      },
    });
    expect(JSON.stringify(writeOutput.mock.calls)).not.toContain(kenyaPhone);
    expect(JSON.stringify(writeOutput.mock.calls)).toContain("Kenya");
    expect(JSON.stringify(writeOutput.mock.calls)).toContain("English");
  });

  it.each([
    ["English", "en-UA"],
    ["Ukrainian", "uk-UA"],
  ] as const)(
    "derives the canonical Ukraine %s profile",
    async (language, locale) => {
      const { createPreflightProcess } = await freshModule();
      const run = createPreflightProcess();
      const input = validInput({
        env: {
          CALLE_API_KEY: apiKey,
          SUPPLIER_TEST_PHONE: ukrainePhone,
          SUPPLIER_TEST_LANGUAGE: language,
        },
      });

      const summary = await run(input);

      expect(input.execute).toHaveBeenCalledWith({
        scenario: "answered",
        apiKey,
        recipient: {
          recipientName: "Consenting participant",
          phoneE164: ukrainePhone,
          maskedPhone: "+380 **-***-0000",
          region: "UA",
          locale,
        },
      });
      expect(summary).toMatchObject({
        country: "Ukraine",
        language,
        region: "UA",
        locale,
        maskedPhone: "+380 **-***-0000",
      });
      const output = JSON.stringify(
        (input.writeOutput as ReturnType<typeof vi.fn>).mock.calls,
      );
      expect(output).toContain("Ukraine");
      expect(output).toContain(language);
      expect(output).toContain("UA");
      expect(output).toContain(locale);
      expect(output).not.toContain(ukrainePhone);
    },
  );
});

describe("actual offline CLI composition", () => {
  it("does not export unguarded live execution, writer, or configurable composition", async () => {
    const preflightModule = (await freshModule()) as Record<string, unknown>;

    expect(preflightModule).toHaveProperty("runCliPreflight");
    expect(preflightModule.runCliPreflight).toBeTypeOf("function");
    expect(
      (preflightModule.runCliPreflight as (...arguments_: never[]) => unknown)
        .length,
    ).toBe(0);
    expect(preflightModule).not.toHaveProperty("executeLivePreflight");
    expect(preflightModule).not.toHaveProperty("createCliPreflightProcess");
    expect(preflightModule).not.toHaveProperty("writePrivateEvidence");
  });

  it("fails real CLI configuration with zero provider POSTs and no evidence", async () => {
    await removeSession(guardedRunId);
    const result = await runGuardedCli({ phone });

    expect(result.error).toMatchObject({
      code: "PREFLIGHT_CONFIGURATION_REQUIRED",
    });
    expect(result.fetchMock).not.toHaveBeenCalled();
    await expect(readdir(resolve(privateRoot, guardedRunId))).rejects.toThrow();
  });

  it.each([
    ["wrong national length", ["+380", "100", "000", "00"].join("")],
    ["leading national zero", ["+380", "000", "000", "000"].join("")],
    ["whitespace", ["+380", "100", " 000", "000"].join("")],
    ["separator", ["+380", "100", "-000", "000"].join("")],
    ["local format", ["0", "100", "000", "000"].join("")],
  ] as const)(
    "rejects malformed Ukraine %s before prompting, provider execution, or evidence",
    async (_case, invalidPhone) => {
      await removeSession(guardedRunId);
      const result = await runGuardedCli({
        apiKey,
        phone: invalidPhone,
        language: "English",
      });

      expect(result.error).toMatchObject({
        code: "UNSUPPORTED_RECIPIENT_REGION",
      });
      expect(result.promptMock).not.toHaveBeenCalled();
      expect(result.fetchMock).not.toHaveBeenCalled();
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(0);
      expect(result.output).not.toContain(invalidPhone);
      await expect(
        readdir(resolve(privateRoot, guardedRunId)),
      ).rejects.toThrow();
    },
  );

  it.each([
    {
      interactive: false,
      phrase: "AUTHORIZE ONE CALL",
      code: "PREFLIGHT_INTERACTIVE_REQUIRED",
    },
    {
      interactive: true,
      phrase: "authorize one call",
      code: "AUTHORIZATION_REQUIRED",
    },
  ])(
    "enforces the real CLI $code guard before provider execution",
    async (guard) => {
      await removeSession(guardedRunId);
      const result = await runGuardedCli({
        apiKey,
        phone,
        interactive: guard.interactive,
        phrase: guard.phrase,
      });

      expect(result.error).toMatchObject({ code: guard.code });
      expect(result.fetchMock).not.toHaveBeenCalled();
      await expect(
        readdir(resolve(privateRoot, guardedRunId)),
      ).rejects.toThrow();
    },
  );

  it("uses guarded private composition from an alternate CWD with exactly one POST", async () => {
    await removeSession(guardedRunId);
    const outside = await mkdtemp(resolve(tmpdir(), "supplysignal-preflight-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(outside);
      const result = await runGuardedCli({ apiKey, phone });

      expect(result.error).toBeUndefined();
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      const privateEvidence = await readFile(
        resolve(privateRoot, guardedRunId, "result.json"),
        "utf8",
      );
      expect(privateEvidence).toContain(
        '"status": "PROVIDER_REPORTED_TERMINAL"',
      );
      expect(privateEvidence).toContain(phone);
      expect(result.output).not.toContain(phone);
      expect(result.output).not.toContain(apiKey);
      await expect(readdir(resolve(outside, "tmp"))).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await removeSession(guardedRunId);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("composes the guarded Kenya request with exactly one local fake POST", async () => {
    await removeSession(guardedRunId);
    let postBody: Record<string, unknown> | undefined;
    const result = await runGuardedCli({
      apiKey,
      phone: kenyaPhone,
      fetchMock: async (url, init) => {
        if (init?.method === "POST") {
          postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse(await fixture("create-accepted.json"), 201);
        }
        if (String(url).endsWith("/events")) {
          return jsonResponse(await fixture("events-page.json"));
        }
        return jsonResponse(await fixture("completed-valid.json"));
      },
    });

    try {
      expect(result.error).toBeUndefined();
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(postBody?.recipients).toEqual([
        { phones: [kenyaPhone], region: "KE", locale: "en-KE" },
      ]);
      expect(result.output).not.toContain(kenyaPhone);
    } finally {
      await removeSession(guardedRunId);
    }
  });

  it.each([
    ["English", "en-UA"],
    ["Ukrainian", "uk-UA"],
  ] as const)(
    "composes the guarded Ukraine %s request with exactly one local fake POST",
    async (language, locale) => {
      await removeSession(guardedRunId);
      try {
        const result = await runGuardedCli({
          apiKey,
          phone: ukrainePhone,
          language,
        });

        expect(result.error).toBeUndefined();
        expect(
          result.fetchMock.mock.calls.filter(
            ([, request]) => request?.method === "POST",
          ),
        ).toHaveLength(1);
        const [, postRequest] =
          result.fetchMock.mock.calls.find(
            ([, request]) => request?.method === "POST",
          ) ?? [];
        const body = JSON.parse(String(postRequest?.body)) as {
          recipients: readonly {
            phones: readonly string[];
            region: string;
            locale: string;
          }[];
          task: string;
        };
        expect(body.recipients).toEqual([
          { phones: [ukrainePhone], region: "UA", locale },
        ]);
        expect(body.task).toContain(
          language === "Ukrainian"
            ? "автоматизованим агентом на основі ШІ"
            : "AI-assisted fictional supplier demo",
        );
        expect(result.output).not.toContain(ukrainePhone);
      } finally {
        await removeSession(guardedRunId);
      }
    },
  );

  it("returns bounded pending after guarded polling remains active with one POST", async () => {
    await removeSession(guardedRunId);
    const result = await runGuardedCli({
      apiKey,
      phone,
      fetchMock: async (_url, init) =>
        init?.method === "POST"
          ? jsonResponse(await fixture("create-accepted.json"), 201)
          : jsonResponse(await fixture("in-progress.json")),
    });

    try {
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(result.output).not.toContain('"status"');
      await expect(
        readFile(resolve(privateRoot, guardedRunId, "result.json")),
      ).rejects.toThrow();
    } finally {
      await removeSession(guardedRunId);
    }
  }, 15_000);

  it("fails bounded when guarded event pagination remains incomplete", async () => {
    await removeSession(guardedRunId);
    const continuedEvents = JSON.parse(
      await fixture("events-page.json"),
    ) as Record<string, unknown>;
    continuedEvents.next_cursor = "cursor_more";
    const result = await runGuardedCli({
      apiKey,
      phone,
      fetchMock: async (url, init) => {
        if (init?.method === "POST") {
          return jsonResponse(await fixture("create-accepted.json"), 201);
        }
        if (String(url).includes("/events")) {
          return jsonResponse(JSON.stringify(continuedEvents));
        }
        return jsonResponse(await fixture("completed-valid.json"));
      },
    });

    try {
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(result.output).not.toContain('"eventCount"');
    } finally {
      await removeSession(guardedRunId);
    }
  });

  it("rejects a pre-existing redirected private session before any provider POST", async (context) => {
    const session = resolve(privateRoot, guardedRunId);
    const outside = await mkdtemp(resolve(tmpdir(), "supplysignal-redirect-"));
    await removeSession(guardedRunId);
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

    try {
      const result = await runGuardedCli({ apiKey, phone });
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(result.fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(session, { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("fails bounded when the pinned session is swapped during evidence open", async (context) => {
    const session = resolve(privateRoot, guardedRunId);
    const retained = `${session}-retained`;
    const outside = await mkdtemp(resolve(tmpdir(), "supplysignal-swap-"));
    await removeSession(guardedRunId);
    await rm(retained, { recursive: true, force: true });
    let swapped = false;
    let platformUnavailable = false;
    const openedPaths: string[] = [];
    const result = await runGuardedCli({
      apiKey,
      phone,
      mockFileSystem: (actual) => ({
        open: async (...arguments_: Parameters<typeof actual.open>) => {
          const path = String(arguments_[0]);
          openedPaths.push(path);
          if (!swapped && path.includes(".result-") && path.endsWith(".tmp")) {
            try {
              await actual.rename(session, retained);
              await actual.symlink(
                outside,
                session,
                process.platform === "win32" ? "junction" : "dir",
              );
              swapped = true;
            } catch (error: unknown) {
              if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                (error.code === "EPERM" || error.code === "EACCES")
              ) {
                platformUnavailable = true;
                return actual.open(...arguments_);
              }
              throw error;
            }
          }
          return actual.open(...arguments_);
        },
      }),
    });

    try {
      if (platformUnavailable) {
        context.skip();
        return;
      }
      expect(openedPaths.some((path) => path.includes(".result-"))).toBe(true);
      expect(swapped).toBe(true);
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      await expect(readFile(resolve(outside, "result.json"))).rejects.toThrow();
      await expect(readFile(resolve(session, "result.json"))).rejects.toThrow();
    } finally {
      await rm(session, { recursive: true, force: true });
      await rm(retained, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reports temporary unlink failure and retains fail-closed private state", async () => {
    const session = resolve(privateRoot, guardedRunId);
    await removeSession(guardedRunId);
    const result = await runGuardedCli({
      apiKey,
      phone,
      mockFileSystem: (actual) => ({
        unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
          if (
            String(path).includes(".result-") &&
            String(path).endsWith(".tmp")
          ) {
            const error = new Error(
              "simulated private cleanup failure",
            ) as Error & {
              code: string;
            };
            error.code = "EACCES";
            throw error;
          }
          return actual.unlink(path);
        },
      }),
    });

    try {
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(result.output).not.toContain('"status"');
      const entries = await readdir(session);
      const temporaryName = entries.find(
        (entry) => entry.startsWith(".result-") && entry.endsWith(".tmp"),
      );
      expect(temporaryName).toBeDefined();
      expect(entries).toContain("result.json");
      const temporary = await stat(
        resolve(session, temporaryName ?? "missing"),
        {
          bigint: true,
        },
      );
      const final = await stat(resolve(session, "result.json"), {
        bigint: true,
      });
      expect(temporary.dev).toBe(final.dev);
      expect(temporary.ino).toBe(final.ino);
      expect(temporary.nlink).toBe(2n);
      expect(final.nlink).toBe(2n);
    } finally {
      await removeSession(guardedRunId);
    }
  });

  it("rejects link-time mutation after re-reading exact retained-handle bytes", async () => {
    const session = resolve(privateRoot, guardedRunId);
    await removeSession(guardedRunId);
    let mutated = false;
    const result = await runGuardedCli({
      apiKey,
      phone,
      mockFileSystem: (actual) => ({
        link: async (temporaryPath, finalPath) => {
          await actual.link(temporaryPath, finalPath);
          if (!mutated && String(finalPath).endsWith("result.json")) {
            await actual.writeFile(finalPath, "mutated-after-link\n", {
              encoding: "utf8",
              flag: "w",
              mode: 0o600,
            });
            mutated = true;
          }
        },
      }),
    });

    try {
      expect(mutated).toBe(true);
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(result.output).not.toContain('"status"');
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      await expect(readFile(resolve(session, "result.json"))).rejects.toThrow();
    } finally {
      await removeSession(guardedRunId);
    }
  });

  it.each(["temporary", "final"] as const)(
    "does not delete a substituted %s pathname during rollback",
    async (substitutedPath) => {
      const sentinel = `substituted-${substitutedPath}\n`;
      await removeSession(guardedRunId);
      let replacementPath: string | undefined;
      const result = await runGuardedCli({
        apiKey,
        phone,
        mockFileSystem: (actual) => ({
          link: async (temporaryPath, finalPath) => {
            await actual.link(temporaryPath, finalPath);
            if (!String(finalPath).endsWith("result.json")) {
              return;
            }
            replacementPath = String(
              substitutedPath === "temporary" ? temporaryPath : finalPath,
            );
            await actual.unlink(replacementPath);
            await actual.writeFile(replacementPath, sentinel, {
              encoding: "utf8",
              flag: "wx",
              mode: 0o600,
            });
          },
        }),
      });

      try {
        expect(replacementPath).toBeDefined();
        expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
        expect(
          result.fetchMock.mock.calls.filter(
            ([, request]) => request?.method === "POST",
          ),
        ).toHaveLength(1);
        expect(await readFile(replacementPath ?? "missing", "utf8")).toBe(
          sentinel,
        );
      } finally {
        await removeSession(guardedRunId);
      }
    },
  );

  it("performs no fallible filesystem operation after commit unlink succeeds", async () => {
    await removeSession(guardedRunId);
    let committed = false;
    const postCommitOperations: string[] = [];
    const result = await runGuardedCli({
      apiKey,
      phone,
      mockFileSystem: (actual) => {
        async function guardOperation(
          displayName: string,
          operationName: string,
          operation: (...arguments_: unknown[]) => unknown,
          receiver: unknown,
          arguments_: unknown[],
        ): Promise<unknown> {
          if (committed) {
            postCommitOperations.push(displayName);
            throw new Error(`fallible ${displayName} after commit`);
          }
          const result = await Reflect.apply(operation, receiver, arguments_);
          if (
            operationName === "unlink" &&
            String(arguments_[0]).includes(".result-") &&
            String(arguments_[0]).endsWith(".tmp")
          ) {
            committed = true;
          }
          if (
            operationName !== "open" ||
            typeof result !== "object" ||
            result === null
          ) {
            return result;
          }
          return new Proxy(result, {
            get(target, property) {
              const member = Reflect.get(target, property, target) as unknown;
              if (typeof member !== "function") {
                return member;
              }
              return (...resourceArguments: unknown[]) =>
                guardOperation(
                  `${displayName}.${String(property)}`,
                  String(property),
                  member as (...arguments_: unknown[]) => unknown,
                  target,
                  resourceArguments,
                );
            },
          });
        }

        function guardNamespace(namespace: object, prefix: string): object {
          return new Proxy(namespace, {
            get(target, property) {
              const value = Reflect.get(target, property, target) as unknown;
              if (typeof value !== "function") {
                return value;
              }
              return (...arguments_: unknown[]) =>
                guardOperation(
                  `${prefix}.${String(property)}`,
                  String(property),
                  value as (...arguments_: unknown[]) => unknown,
                  target,
                  arguments_,
                );
            },
          });
        }

        return Object.fromEntries(
          Reflect.ownKeys(actual).map((property) => {
            const name = String(property);
            const value = Reflect.get(actual, property) as unknown;
            if (name === "default" && typeof value === "object" && value) {
              return [property, guardNamespace(value, name)];
            }
            if (typeof value !== "function") {
              return [property, value];
            }
            return [
              property,
              (...arguments_: unknown[]) =>
                guardOperation(
                  name,
                  name,
                  value as (...arguments_: unknown[]) => unknown,
                  actual,
                  arguments_,
                ),
            ];
          }),
        ) as Partial<typeof actual>;
      },
    });

    try {
      expect(committed).toBe(true);
      expect(postCommitOperations).toEqual([]);
      expect(result.error).toBeUndefined();
      expect(result.output).toContain('"status":"PROVIDER_REPORTED_TERMINAL"');
    } finally {
      await removeSession(guardedRunId);
    }
  });

  it("preserves committed success when sanitized output reporting throws", async () => {
    const { createPreflightProcess } = await freshModule();
    let evidenceCommitted = false;
    const writeOutput = vi.fn((message: string) => {
      if (message.startsWith("{")) {
        throw new Error("simulated post-commit output failure");
      }
    });
    const input = validInput({
      writeOutput,
      writePrivateEvidence: vi.fn(async () => {
        evidenceCommitted = true;
      }),
    });

    await expect(createPreflightProcess()(input)).resolves.toMatchObject({
      status: "PROVIDER_REPORTED_TERMINAL",
    });
    expect(evidenceCommitted).toBe(true);
    expect(writeOutput).toHaveBeenCalledTimes(2);
  });

  it("does not hide output failures before provider execution", async () => {
    const { createPreflightProcess } = await freshModule();
    const input = validInput({
      writeOutput: vi.fn(() => {
        throw new Error("simulated pre-commit output failure");
      }),
    });

    await expect(createPreflightProcess()(input)).rejects.toThrow(
      "simulated pre-commit output failure",
    );
    expect(input.execute).not.toHaveBeenCalled();
    expect(input.writePrivateEvidence).not.toHaveBeenCalled();
  });

  it("keeps private evidence create-only when the final name already exists", async () => {
    const session = resolve(privateRoot, guardedRunId);
    const sentinel = "pre-existing private evidence\n";
    await removeSession(guardedRunId);
    let planted = false;
    const result = await runGuardedCli({
      apiKey,
      phone,
      mockFileSystem: (actual) => ({
        link: async (existingPath, finalPath) => {
          if (!planted && String(finalPath).endsWith("result.json")) {
            await actual.writeFile(finalPath, sentinel, {
              encoding: "utf8",
              flag: "wx",
              mode: 0o600,
            });
            planted = true;
          }
          return actual.link(existingPath, finalPath);
        },
      }),
    });

    try {
      expect(planted).toBe(true);
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(await readFile(resolve(session, "result.json"), "utf8")).toBe(
        sentinel,
      );
      expect(
        (await readdir(session)).filter((entry) => entry.endsWith(".tmp")),
      ).toHaveLength(0);
    } finally {
      await removeSession(guardedRunId);
    }
  });

  it("rejects oversized private evidence before publishing a final file", async () => {
    await removeSession(guardedRunId);
    const basePage = JSON.parse(await fixture("events-page.json")) as Record<
      string,
      unknown
    >;
    const baseEvent = (basePage.data as Record<string, unknown>[])[0];
    if (baseEvent === undefined) {
      throw new Error("Expected an event fixture");
    }
    let eventPage = 0;
    const result = await runGuardedCli({
      apiKey,
      phone,
      fetchMock: async (url, init) => {
        if (init?.method === "POST") {
          return jsonResponse(await fixture("create-accepted.json"), 201);
        }
        if (!String(url).includes("/events")) {
          return jsonResponse(await fixture("completed-valid.json"));
        }
        eventPage += 1;
        return jsonResponse(
          JSON.stringify({
            object: "list",
            data: Array.from({ length: 50 }, (_, index) => ({
              ...baseEvent,
              id: `event_${eventPage}_${index}`,
              message: "x".repeat(4_000),
            })),
            next_cursor: eventPage < 10 ? `cursor_${eventPage}` : null,
          }),
        );
      },
    });

    try {
      expect(eventPage).toBe(10);
      expect(result.error).toMatchObject({ code: "CALL_OUTCOME_PENDING" });
      expect(
        result.fetchMock.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(1);
      await expect(
        readFile(resolve(privateRoot, guardedRunId, "result.json")),
      ).rejects.toThrow();
    } finally {
      await removeSession(guardedRunId);
    }
  });
});
