import { describe, expect, it, vi } from "vitest";

import type { RunRecord } from "../src/domain/run.js";
import {
  createPreflightProcess,
  type PreflightExecutionInput,
  type PreflightExecutionResult,
} from "./live-preflight.js";

const apiKey = "server-only-test-token";
const phone = ["+1", "202", "555", "0147"].join("");

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
  overrides: Partial<
    Parameters<ReturnType<typeof createPreflightProcess>>[0]
  > = {},
) {
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

describe("live CALL-E preflight safety boundary", () => {
  it("rejects a missing CALL-E API key before execution", async () => {
    const run = createPreflightProcess();
    const input = validInput({
      env: { SUPPLIER_TEST_PHONE: phone },
    });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_CONFIGURATION_REQUIRED",
    });
    expect(input.execute).not.toHaveBeenCalled();
  });

  it("rejects a missing supplier phone before execution", async () => {
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
    const run = createPreflightProcess();
    const input = validInput({ isInteractive: false });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_INTERACTIVE_REQUIRED",
    });
    expect(input.prompt).not.toHaveBeenCalled();
    expect(input.execute).not.toHaveBeenCalled();
  });

  it.each(["", "authorize one call", "AUTHORIZE ONE CALL "])(
    "rejects non-exact authorization phrase %j",
    async (confirmation) => {
      const run = createPreflightProcess();
      const input = validInput({ prompt: vi.fn(async () => confirmation) });

      await expect(run(input)).rejects.toMatchObject({
        code: "AUTHORIZATION_REQUIRED",
      });
      expect(input.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    { argv: [] },
    { argv: ["--scenario", "unexpected"] },
    { argv: ["--scenario", "answered", "--scenario", "declined"] },
    { argv: ["--scenario", "answered", "--phone", phone] },
  ])("rejects invalid or ambiguous arguments $argv", async ({ argv }) => {
    const run = createPreflightProcess();
    const input = validInput({ argv });

    await expect(run(input)).rejects.toMatchObject({
      code: "PREFLIGHT_SCENARIO_INVALID",
    });
    expect(input.execute).not.toHaveBeenCalled();
  });

  it("allows only one call execution attempt in one process", async () => {
    const run = createPreflightProcess();
    const first = validInput();
    const second = validInput({ argv: ["--scenario", "declined"] });

    await expect(run(first)).resolves.toMatchObject({
      scenario: "answered",
      maskedPhone: "+1 ***-***-0147",
      status: "PROVIDER_REPORTED_TERMINAL",
    });
    await expect(run(second)).rejects.toMatchObject({
      code: "PREFLIGHT_CALL_LIMIT_REACHED",
    });
    expect(first.execute).toHaveBeenCalledTimes(1);
    expect(second.execute).not.toHaveBeenCalled();
  });

  it("prints only the scenario, masked phone, and sanitized result", async () => {
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
