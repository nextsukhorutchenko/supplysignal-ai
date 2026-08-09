import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileRunStore } from "../../src/adapters/filesystem/run-store.js";
import { reconcileRun } from "../../src/application/reconcile-run.js";
import { startRun } from "../../src/application/start-run.js";
import type {
  CalleCallSnapshot,
  CalleEventPage,
  CalleGateway,
  Clock,
  CreateSupplierCall,
} from "../../src/application/ports.js";
import type { RunRecord } from "../../src/domain/run.js";

const fictionalPhone = ["+1", "202", "555", "0198"].join("");
const clock: Clock = {
  now: () => "2026-08-08T12:15:00.000Z",
  sleep: async () => undefined,
};
const roots: string[] = [];

function authorizedRun(): RunRecord {
  return {
    id: "run-lifecycle",
    version: 0,
    status: "AWAITING_APPROVAL",
    trustStatus: "UNVERIFIED_PROVIDER_RESULT",
    order: {
      supplierName: "Northstar Components",
      purchaseOrderRef: "PO-2048",
      expectedQuantity: 500,
      requiredDeliveryDate: "2026-08-15",
    },
    recipient: {
      recipientName: "Consenting participant",
      phoneE164: fictionalPhone,
      maskedPhone: "+1 ***-***-0198",
      region: "US",
      locale: "en-US",
    },
    authorization: {
      consentToCall: true,
      consentToRecord: true,
      consentToPublish: true,
      supportedRegionConfirmed: true,
      phoneReviewed: true,
      fictionalDataConfirmed: true,
      authorizedAt: "2026-08-08T12:05:00.000Z",
      authorizationDigest: `sha256:${"a".repeat(64)}`,
    },
    schemaValidation: "not_run",
    consistencyValidation: "not_run",
    artifactState: "none",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:05:00.000Z",
  };
}

class LifecycleCalle implements CalleGateway {
  readonly creates: CreateSupplierCall[] = [];
  readonly gets: string[] = [];
  status: CalleCallSnapshot["status"] = "queued";

  private snapshot(): CalleCallSnapshot {
    return {
      callId: "call_demo_001",
      status: this.status,
      observedAt: "2026-08-08T12:15:00.000Z",
      taskCompleted: this.status === "completed" ? true : null,
      completionConfidence: null,
      transcript: [],
      structuredResult:
        this.status === "completed"
          ? {
              contactOutcome: "declined",
              confirmedQuantity: 0,
              availableQuantity: 0,
              delayedQuantity: 0,
              promisedDeliveryDate: "unknown",
              delayReason: "unknown",
              followUpRequired: "unknown",
              unableToFulfill: "unknown",
            }
          : null,
      evidence: [],
    };
  }

  async createCall(input: CreateSupplierCall): Promise<CalleCallSnapshot> {
    this.creates.push(structuredClone(input));
    return this.snapshot();
  }

  async getCall(callId: string): Promise<CalleCallSnapshot> {
    this.gets.push(callId);
    return this.snapshot();
  }

  async listEvents(): Promise<CalleEventPage> {
    throw new Error("Events are informational and not used for completion");
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("one-call lifecycle", () => {
  it("keeps one provider identity across concurrent start, refresh, and terminal reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "supplysignal-call-lifecycle-"));
    roots.push(root);
    const firstStore = new FileRunStore({ root, clock });
    const secondStore = new FileRunStore({ root, clock });
    const calle = new LifecycleCalle();
    await firstStore.create(authorizedRun());

    await Promise.allSettled([
      startRun({ store: firstStore, calle, clock }, "run-lifecycle"),
      startRun({ store: secondStore, calle, clock }, "run-lifecycle"),
    ]);
    const afterStart = await firstStore.read("run-lifecycle");
    expect(afterStart.callId).toBe("call_demo_001");
    expect(calle.creates).toHaveLength(1);
    expect(
      new Set(calle.creates.map((input) => input.idempotencyKey)).size,
    ).toBe(1);

    calle.status = "completed";
    const completedByProvider = await reconcileRun(
      { store: secondStore, calle, clock },
      "run-lifecycle",
    );

    expect(completedByProvider.status).toBe("PROVIDER_REPORTED_TERMINAL");
    expect(completedByProvider.status).not.toBe("COMPLETED");
    expect(calle.creates).toHaveLength(1);
    expect(calle.gets).toEqual(["call_demo_001"]);
  });
});
