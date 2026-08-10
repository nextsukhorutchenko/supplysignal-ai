import { describe, expect, it } from "vitest";

import { CalleError } from "../adapters/calle/client.js";
import { AppError } from "../domain/errors.js";
import type { ProviderEvidenceSnapshot, RunRecord } from "../domain/run.js";
import { deriveCallIdentity } from "./idempotency.js";
import { reconcileRun } from "./reconcile-run.js";
import type {
  CalleCallSnapshot,
  CalleEventPage,
  CalleGateway,
  Clock,
  CreateSupplierCall,
  RunStore,
} from "./ports.js";

const fictionalPhone = ["+1", "202", "555", "0198"].join("");
const fixedNow = "2026-08-08T12:15:00.000Z";
const clock: Clock = { now: () => fixedNow, sleep: async () => undefined };

function activeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const base: RunRecord = {
    id: "run-001",
    version: 6,
    status: "RECONCILING",
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
    updatedAt: "2026-08-08T12:10:00.000Z",
  };
  const identity = deriveCallIdentity(base);
  return { ...base, ...identity, ...overrides };
}

function snapshot(
  status: ProviderEvidenceSnapshot["status"],
  callId = "call_demo_001",
): CalleCallSnapshot {
  return {
    callId,
    status,
    observedAt: fixedNow,
    taskCompleted: status === "completed" ? true : null,
    completionConfidence: null,
    transcript: [],
    structuredResult:
      status === "completed"
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

class MemoryStore implements RunStore {
  constructor(public current: RunRecord) {}
  async create(): Promise<void> {
    throw new Error("unused");
  }
  async read(): Promise<RunRecord> {
    return structuredClone(this.current);
  }
  async compareAndSwap(
    _id: string,
    expected: number,
    next: RunRecord,
  ): Promise<RunRecord> {
    if (this.current.version !== expected)
      throw new Error("RUN_STORE_CONFLICT");
    this.current = structuredClone(next);
    return structuredClone(next);
  }
}

class FakeCalle implements CalleGateway {
  readonly creates: CreateSupplierCall[] = [];
  readonly gets: string[] = [];
  readonly events: string[] = [];
  createResult: CalleCallSnapshot | Error = snapshot("queued");
  getResult: CalleCallSnapshot | Error = snapshot("in_progress");
  async createCall(input: CreateSupplierCall): Promise<CalleCallSnapshot> {
    this.creates.push(structuredClone(input));
    if (this.createResult instanceof Error) throw this.createResult;
    return this.createResult;
  }
  async getCall(callId: string): Promise<CalleCallSnapshot> {
    this.gets.push(callId);
    if (this.getResult instanceof Error) throw this.getResult;
    return this.getResult;
  }
  async listEvents(callId: string): Promise<CalleEventPage> {
    this.events.push(callId);
    return {
      events: [
        {
          id: "event-001",
          type: "completed",
          occurredAt: fixedNow,
          summary: "completed",
        },
      ],
      nextCursor: null,
    };
  }
}

class TerminalRaceStore implements RunStore {
  private failedPersistedResolve: (() => void) | undefined;
  private readonly failedPersisted = new Promise<void>((resolve) => {
    this.failedPersistedResolve = resolve;
  });

  constructor(public current: RunRecord) {}

  async create(): Promise<void> {
    throw new Error("unused");
  }

  async read(): Promise<RunRecord> {
    return structuredClone(this.current);
  }

  async compareAndSwap(
    _id: string,
    expected: number,
    next: RunRecord,
  ): Promise<RunRecord> {
    if (next.status === "RECONCILING") {
      await this.failedPersisted;
    }
    if (this.current.version !== expected) {
      throw new Error("RUN_STORE_CONFLICT");
    }
    this.current = structuredClone(next);
    if (next.status === "FAILED") {
      this.failedPersistedResolve?.();
    }
    return structuredClone(next);
  }
}

describe("reconcileRun", () => {
  it.each(["CALL_STARTING", "RECONCILING"] as const)(
    "does not POST while reconciling a %s run without a call ID",
    async (status) => {
      // Catches recovery create from persisted state after the original
      // claim-owning invocation is no longer available.
      const original = activeRun({ status });
      const store = new MemoryStore(original);
      const calle = new FakeCalle();

      await expect(
        reconcileRun({ store, calle, clock }, original.id),
      ).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
        message: "CALL_OUTCOME_PENDING",
      });

      expect(calle.creates).toHaveLength(0);
      expect(calle.gets).toHaveLength(0);
      expect(store.current).toEqual(original);
    },
  );

  it("leaves a restarted CALL_STARTING run pending without another POST", async () => {
    const original = activeRun({ status: "CALL_STARTING" });
    const store = new MemoryStore(original);
    const calle = new FakeCalle();

    await expect(
      reconcileRun({ store, calle, clock }, original.id),
    ).rejects.toMatchObject({
      code: "CALL_OUTCOME_PENDING",
      message: "CALL_OUTCOME_PENDING",
    });

    expect(calle.creates).toHaveLength(0);
    expect(store.current).toEqual(original);
  });

  it("never creates when a call identifier exists", async () => {
    const store = new MemoryStore(activeRun({ callId: "call_demo_001" }));
    const calle = new FakeCalle();

    const result = await reconcileRun({ store, calle, clock }, "run-001");

    expect(result.status).toBe("CALL_IN_PROGRESS");
    expect(calle.creates).toHaveLength(0);
    expect(calle.gets).toEqual(["call_demo_001"]);
  });

  it.each([
    ["queued", "CALL_STARTING"],
    ["in_progress", "CALL_IN_PROGRESS"],
    ["completed", "PROVIDER_REPORTED_TERMINAL"],
    ["failed", "FAILED"],
    ["canceled", "FAILED"],
    ["unknown", "OUTCOME_UNKNOWN"],
  ] as const)(
    "maps provider %s to %s without application completion",
    async (provider, expected) => {
      const store = new MemoryStore(activeRun({ callId: "call_demo_001" }));
      const calle = new FakeCalle();
      calle.getResult = snapshot(provider);

      const result = await reconcileRun({ store, calle, clock }, "run-001");

      expect(result.status).toBe(expected);
      expect(result.status).not.toBe("COMPLETED");
      expect(result.providerSnapshot?.status).toBe(provider);
      expect(calle.events).toHaveLength(0);
    },
  );

  it("fails closed when the provider returns a different call identity", async () => {
    const store = new MemoryStore(activeRun({ callId: "call_demo_001" }));
    const calle = new FakeCalle();
    calle.getResult = snapshot("completed", "call_demo_999");

    const result = await reconcileRun({ store, calle, clock }, "run-001");

    expect(result.status).toBe("OUTCOME_UNKNOWN");
    expect(result.callId).toBe("call_demo_001");
    expect(calle.creates).toHaveLength(0);
  });

  it("keeps reconciliation pending without attempting ambiguous recovery create", async () => {
    const store = new MemoryStore(activeRun());
    const calle = new FakeCalle();
    calle.createResult = new CalleError(
      "CALL_OUTCOME_PENDING",
      "ambiguous_create",
    );

    await expect(
      reconcileRun({ store, calle, clock }, "run-001"),
    ).rejects.toMatchObject({
      code: "CALL_OUTCOME_PENDING",
      message: "CALL_OUTCOME_PENDING",
    });
    expect(store.current.status).toBe("RECONCILING");
    expect(store.current.idempotencyKey).toBe(activeRun().idempotencyKey);
    expect(calle.creates).toHaveLength(0);
  });

  it("does not reach a configured definite create rejection during manual resolution", async () => {
    const store = new MemoryStore(activeRun());
    const calle = new FakeCalle();
    calle.createResult = new CalleError(
      "CALL_CREATION_FAILED",
      "idempotency_conflict",
    );

    await expect(
      reconcileRun({ store, calle, clock }, "run-001"),
    ).rejects.toMatchObject({ code: "CALL_OUTCOME_PENDING" });
    await expect(
      reconcileRun({ store, calle, clock }, "run-001"),
    ).rejects.toMatchObject({ code: "CALL_OUTCOME_PENDING" });

    expect(store.current.status).toBe("RECONCILING");
    expect(calle.creates).toHaveLength(0);
  });

  it("bounds competing failed and completed terminal observations without a stale transition", async () => {
    const store = new TerminalRaceStore(
      activeRun({ status: "CALL_STARTING", callId: "call_demo_001" }),
    );
    let reads = 0;
    let releaseReads: (() => void) | undefined;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const calle = new FakeCalle();
    calle.getCall = async () => {
      const callNumber = (reads += 1);
      if (callNumber === 2) releaseReads?.();
      await bothRead;
      return callNumber === 1 ? snapshot("completed") : snapshot("failed");
    };

    const results = await Promise.allSettled([
      reconcileRun({ store, calle, clock }, "run-001"),
      reconcileRun({ store, calle, clock }, "run-001"),
    ]);

    expect(store.current.status).toBe("FAILED");
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AppError);
        expect(result.reason).not.toMatchObject({
          code: "RUN_TRANSITION_FORBIDDEN",
        });
      }
    }
  });
});
