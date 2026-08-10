import { describe, expect, it } from "vitest";

import type { RunRecord } from "./run.js";
import { canCompleteRun } from "./trust.js";

const fictionalPhone = `+1${"2".repeat(10)}`;

function createRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
    version: 3,
    status: "PROVIDER_REPORTED_TERMINAL",
    trustStatus: "HUMAN_CONFIRMED",
    order: {
      supplierName: "Northstar Components",
      purchaseOrderRef: "PO-2048",
      expectedQuantity: 500,
      requiredDeliveryDate: "2026-08-15",
    },
    recipient: {
      recipientName: "Demo Supplier",
      phoneE164: fictionalPhone,
      maskedPhone: "+1 ***-***-2222",
      region: "US",
      locale: "en-US",
    },
    schemaValidation: "passed",
    consistencyValidation: "passed",
    artifactState: "published",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:01:00.000Z",
    ...overrides,
  };
}

describe("canCompleteRun", () => {
  it("allows completion only when every independent completion condition holds", () => {
    expect(canCompleteRun(createRun())).toBe(true);
  });

  it.each([
    ["the lifecycle is not provider terminal", { status: "CALL_IN_PROGRESS" }],
    ["schema validation did not pass", { schemaValidation: "failed" }],
    [
      "consistency validation did not pass",
      { consistencyValidation: "failed" },
    ],
    [
      "human confirmation is absent",
      { trustStatus: "CONSISTENCY_CHECK_PASSED" },
    ],
    ["artifacts are ready but not published", { artifactState: "ready" }],
  ] as const)("rejects completion when %s", (_reason, overrides) => {
    expect(canCompleteRun(createRun(overrides))).toBe(false);
  });

  it("does not treat provider claims or untrusted human review as completion proof", () => {
    expect(
      canCompleteRun(
        createRun({
          trustStatus: "UNVERIFIED_PROVIDER_RESULT",
          humanReview: { approved: true },
          providerSnapshot: {
            callId: "provider-call-001",
            status: "completed",
            observedAt: "2026-08-08T12:00:30.000Z",
            taskCompleted: true,
            completionConfidence: { score: 1, label: "certain" },
            transcript: [{ speaker: "user", text: "Complete" }],
            structuredResult: { complete: true },
            evidence: [
              { id: "evidence-001", excerpt: "Complete", turnIndexes: [0] },
            ],
          },
        }),
      ),
    ).toBe(false);
  });
});
