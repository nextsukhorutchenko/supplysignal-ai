import { describe, expect, it } from "vitest";

import { CalleError } from "../adapters/calle/client.js";
import { AppError } from "../domain/errors.js";
import type { ProviderEvidenceSnapshot, RunRecord } from "../domain/run.js";
import { deriveCallIdentity } from "./idempotency.js";
import { startRun } from "./start-run.js";
import type {
  CalleCallSnapshot,
  CalleEventPage,
  CalleGateway,
  Clock,
  CreateSupplierCall,
  RunStore,
} from "./ports.js";

const fictionalPhone = ["+1", "202", "555", "0198"].join("");
const fixedNow = "2026-08-08T12:10:00.000Z";

const clock: Clock = {
  now: () => fixedNow,
  sleep: async () => undefined,
};

function authorizedRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
    version: 5,
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
    ...overrides,
  };
}

function snapshot(
  status: ProviderEvidenceSnapshot["status"] = "queued",
  callId = "call_demo_001",
): CalleCallSnapshot {
  return {
    callId,
    status,
    observedAt: fixedNow,
    taskCompleted: null,
    completionConfidence: null,
    transcript: [],
    structuredResult: null,
    evidence: [],
  };
}

class MemoryStore implements RunStore {
  readonly swaps: RunRecord[] = [];
  failNextSwap = false;

  constructor(public current: RunRecord) {}

  async create(): Promise<void> {
    throw new Error("unused");
  }

  async read(): Promise<RunRecord> {
    return structuredClone(this.current);
  }

  async compareAndSwap(
    _runId: string,
    expectedVersion: number,
    next: RunRecord,
  ): Promise<RunRecord> {
    if (this.failNextSwap) {
      this.failNextSwap = false;
      throw new Error("RUN_STORE_WRITE_FAILED");
    }
    if (this.current.version !== expectedVersion) {
      throw new Error("RUN_STORE_CONFLICT");
    }
    this.current = structuredClone(next);
    this.swaps.push(structuredClone(next));
    return structuredClone(next);
  }
}

class FakeCalle implements CalleGateway {
  readonly createInputs: CreateSupplierCall[] = [];
  readonly getIds: string[] = [];
  readonly eventIds: string[] = [];
  createImplementation: (
    input: CreateSupplierCall,
  ) => Promise<CalleCallSnapshot> = async () => snapshot();

  async createCall(input: CreateSupplierCall): Promise<CalleCallSnapshot> {
    this.createInputs.push(structuredClone(input));
    return this.createImplementation(input);
  }

  async getCall(callId: string): Promise<CalleCallSnapshot> {
    this.getIds.push(callId);
    return snapshot("in_progress", callId);
  }

  async listEvents(callId: string): Promise<CalleEventPage> {
    this.eventIds.push(callId);
    return { events: [], nextCursor: null };
  }
}

async function expectCode(
  promise: Promise<unknown>,
  code:
    "AUTHORIZATION_REQUIRED" | "CALL_CREATION_FAILED" | "CALL_OUTCOME_PENDING",
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code, message: code });
}

describe("startRun", () => {
  it("rejects a run without one-call authorization before provider access", async () => {
    const store = new MemoryStore(authorizedRun({ authorization: undefined }));
    const calle = new FakeCalle();

    await expectCode(
      startRun({ store, calle, clock }, "run-001"),
      "AUTHORIZATION_REQUIRED",
    );

    expect(store.swaps).toHaveLength(0);
    expect(calle.createInputs).toHaveLength(0);
  });

  it("persists CALL_STARTING with one key and request digest before create", async () => {
    const store = new MemoryStore(authorizedRun());
    const calle = new FakeCalle();
    calle.createImplementation = async (input) => {
      expect(store.current).toMatchObject({
        status: "CALL_STARTING",
        idempotencyKey: input.idempotencyKey,
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      return snapshot();
    };

    const result = await startRun({ store, calle, clock }, "run-001");

    expect(result).toMatchObject({
      status: "CALL_STARTING",
      callId: "call_demo_001",
      providerSnapshot: { callId: "call_demo_001", status: "queued" },
    });
    expect(store.swaps[0]).toMatchObject({ status: "CALL_STARTING" });
    expect(calle.createInputs).toHaveLength(1);
  });

  it("lets only one simultaneous claimant reach provider create", async () => {
    const store = new MemoryStore(authorizedRun());
    const calle = new FakeCalle();

    const results = await Promise.allSettled([
      startRun({ store, calle, clock }, "run-001"),
      startRun({ store, calle, clock }, "run-001"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(calle.createInputs).toHaveLength(1);
    expect(
      new Set(calle.createInputs.map((input) => input.idempotencyKey)).size,
    ).toBeLessThanOrEqual(1);
    expect(store.current.callId).toBe("call_demo_001");
  });

  it("reuses the original key and byte-equivalent request after an ambiguous create", async () => {
    const store = new MemoryStore(authorizedRun());
    const calle = new FakeCalle();
    let attempt = 0;
    calle.createImplementation = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new CalleError("CALL_OUTCOME_PENDING", "ambiguous_create");
      }
      return snapshot();
    };

    await expectCode(
      startRun({ store, calle, clock }, "run-001"),
      "CALL_OUTCOME_PENDING",
    );
    expect(store.current.status).toBe("RECONCILING");
    const firstIdentity = {
      key: store.current.idempotencyKey,
      digest: store.current.requestDigest,
    };

    const result = await startRun({ store, calle, clock }, "run-001");

    expect(result.callId).toBe("call_demo_001");
    expect(calle.createInputs.map((input) => input.idempotencyKey)).toEqual([
      firstIdentity.key,
      firstIdentity.key,
    ]);
    expect(store.current.requestDigest).toBe(firstIdentity.digest);
    expect(calle.createInputs[1]).toEqual(calle.createInputs[0]);
  });

  it("retains the original identity on an idempotency conflict", async () => {
    const store = new MemoryStore(authorizedRun());
    const calle = new FakeCalle();
    calle.createImplementation = async () => {
      throw new CalleError("CALL_CREATION_FAILED", "idempotency_conflict");
    };

    await expectCode(
      startRun({ store, calle, clock }, "run-001"),
      "CALL_CREATION_FAILED",
    );
    const key = store.current.idempotencyKey;
    const digest = store.current.requestDigest;
    await expectCode(
      startRun({ store, calle, clock }, "run-001"),
      "CALL_CREATION_FAILED",
    );

    expect(calle.createInputs.map((input) => input.idempotencyKey)).toEqual([
      key,
      key,
    ]);
    expect(store.current).toMatchObject({
      idempotencyKey: key,
      requestDigest: digest,
    });
  });

  it("treats call-identity persistence failure as pending and recovers with the same request", async () => {
    const store = new MemoryStore(authorizedRun());
    const calle = new FakeCalle();
    calle.createImplementation = async () => {
      store.failNextSwap = true;
      return snapshot();
    };

    await expectCode(
      startRun({ store, calle, clock }, "run-001"),
      "CALL_OUTCOME_PENDING",
    );
    const originalKey = store.current.idempotencyKey;
    const originalDigest = store.current.requestDigest;
    expect(store.current.status).toBe("CALL_STARTING");
    expect(store.current).not.toHaveProperty("callId");

    calle.createImplementation = async () => snapshot();
    const recovered = await startRun({ store, calle, clock }, "run-001");

    expect(recovered.callId).toBe("call_demo_001");
    expect(calle.createInputs.map((input) => input.idempotencyKey)).toEqual([
      originalKey,
      originalKey,
    ]);
    expect(store.current.requestDigest).toBe(originalDigest);
  });

  it("uses GET only when a call identifier is already persisted", async () => {
    const base = authorizedRun({
      version: 7,
      status: "RECONCILING",
      callId: "call_demo_001",
    });
    const store = new MemoryStore({ ...base, ...deriveCallIdentity(base) });
    const calle = new FakeCalle();

    const result = await startRun({ store, calle, clock }, "run-001");

    expect(result.status).toBe("CALL_IN_PROGRESS");
    expect(calle.createInputs).toHaveLength(0);
    expect(calle.getIds).toEqual(["call_demo_001"]);
  });

  it("bounds untrusted provider failures without leaking sensitive detail", async () => {
    const store = new MemoryStore(authorizedRun());
    const calle = new FakeCalle();
    const sensitive = `${fictionalPhone} C:\\private\\provider detail`;
    calle.createImplementation = async () => {
      throw new Error(sensitive);
    };

    try {
      await startRun({ store, calle, clock }, "run-001");
      throw new Error("Expected startRun to reject");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "CALL_CREATION_FAILED" });
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
        sensitive,
      );
    }
  });
});
