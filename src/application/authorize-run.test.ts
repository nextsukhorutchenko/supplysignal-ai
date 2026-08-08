import { describe, expect, it } from "vitest";

import { AppError } from "../domain/errors.js";
import type { RunRecord, RunStatus } from "../domain/run.js";
import { authorizeRun } from "./authorize-run.js";
import type { Clock, RunStore } from "./ports.js";

const fullPhone = "+12025550123";
const fixedNow = "2026-08-08T12:05:00.000Z";

const clock: Clock = {
  now: () => fixedNow,
  sleep: async () => undefined,
};

const validApproval = {
  runId: "run-001",
  formRevision: 4,
  consentToCall: true,
  consentToRecord: true,
  consentToPublish: true,
  supportedRegionConfirmed: true,
  phoneReviewed: true,
  fictionalDataConfirmed: true,
};

function createAwaitingRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
    version: 4,
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
      phoneE164: fullPhone,
      maskedPhone: "+1 ***-***-0123",
      region: "US",
      locale: "en-US",
    },
    schemaValidation: "not_run",
    consistencyValidation: "not_run",
    artifactState: "none",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:01:00.000Z",
    ...overrides,
  };
}

class MemoryRunStore implements RunStore {
  readonly swaps: {
    runId: string;
    expectedVersion: number;
    next: RunRecord;
  }[] = [];

  constructor(
    private current: RunRecord,
    private readonly swapError?: Error,
  ) {}

  async create(): Promise<void> {
    throw new Error("create is not used by authorizeRun");
  }

  async read(): Promise<RunRecord> {
    return this.current;
  }

  async compareAndSwap(
    runId: string,
    expectedVersion: number,
    next: RunRecord,
  ): Promise<RunRecord> {
    this.swaps.push({ runId, expectedVersion, next });
    if (this.swapError !== undefined) {
      throw this.swapError;
    }
    this.current = next;
    return next;
  }
}

async function expectBoundedAuthorizationError(
  promise: Promise<unknown>,
  code:
    | "AUTHORIZATION_REQUIRED"
    | "UNSUPPORTED_RECIPIENT_REGION" = "AUTHORIZATION_REQUIRED",
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected authorizeRun to reject");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code, message: code });
    expect(JSON.stringify(error)).not.toContain(fullPhone);
  }
}

describe("authorizeRun", () => {
  it("persists one immutable run- and revision-bound authorization", async () => {
    const store = new MemoryRunStore(createAwaitingRun());

    const result = await authorizeRun(
      { store, clock },
      {
        runId: "run-001",
        expectedVersion: 4,
        approval: validApproval,
      },
    );

    expect(store.swaps).toHaveLength(1);
    expect(store.swaps[0]).toEqual({
      runId: "run-001",
      expectedVersion: 4,
      next: result,
    });
    expect(result.version).toBe(5);
    expect(result.status).toBe("AWAITING_APPROVAL");
    expect(result.updatedAt).toBe(fixedNow);
    expect(result.authorization).toMatchObject({
      consentToCall: true,
      consentToRecord: true,
      consentToPublish: true,
      supportedRegionConfirmed: true,
      phoneReviewed: true,
      fictionalDataConfirmed: true,
      authorizedAt: fixedNow,
      authorizationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(Object.isFrozen(result.authorization)).toBe(true);
    expect(JSON.stringify(result.authorization)).not.toContain(fullPhone);
  });

  it.each([
    "consentToCall",
    "consentToRecord",
    "consentToPublish",
    "phoneReviewed",
    "fictionalDataConfirmed",
  ] as const)(
    "rejects authorization when %s is not confirmed",
    async (flag) => {
      const store = new MemoryRunStore(createAwaitingRun());

      await expectBoundedAuthorizationError(
        authorizeRun(
          { store, clock },
          {
            runId: "run-001",
            expectedVersion: 4,
            approval: { ...validApproval, [flag]: false },
          },
        ),
      );
      expect(store.swaps).toHaveLength(0);
    },
  );

  it("uses the supported-region error when US support is not confirmed", async () => {
    const store = new MemoryRunStore(createAwaitingRun());

    await expectBoundedAuthorizationError(
      authorizeRun(
        { store, clock },
        {
          runId: "run-001",
          expectedVersion: 4,
          approval: {
            ...validApproval,
            supportedRegionConfirmed: false,
          },
        },
      ),
      "UNSUPPORTED_RECIPIENT_REGION",
    );
    expect(store.swaps).toHaveLength(0);
  });

  it.each([
    [
      "mismatched run binding",
      { approval: { ...validApproval, runId: "run-002" } },
    ],
    [
      "expired form revision",
      { approval: { ...validApproval, formRevision: 3 } },
    ],
    ["stale expected version", { expectedVersion: 3 }],
  ] as const)("rejects a %s", async (_reason, overrides) => {
    const store = new MemoryRunStore(createAwaitingRun());

    await expectBoundedAuthorizationError(
      authorizeRun(
        { store, clock },
        {
          runId: "run-001",
          expectedVersion: 4,
          approval: validApproval,
          ...overrides,
        },
      ),
    );
    expect(store.swaps).toHaveLength(0);
  });

  it.each<RunStatus>([
    "DRAFT",
    "CALL_STARTING",
    "CALL_IN_PROGRESS",
    "RECONCILING",
    "PROVIDER_REPORTED_TERMINAL",
    "COMPLETED",
    "OUTCOME_UNKNOWN",
    "FAILED",
  ])("rejects authorization in the %s lifecycle state", async (status) => {
    const store = new MemoryRunStore(createAwaitingRun({ status }));

    await expectBoundedAuthorizationError(
      authorizeRun(
        { store, clock },
        {
          runId: "run-001",
          expectedVersion: 4,
          approval: validApproval,
        },
      ),
    );
    expect(store.swaps).toHaveLength(0);
  });

  it("rejects reauthorization without replacing the immutable value", async () => {
    const existingAuthorization = Object.freeze({
      consentToCall: true,
      consentToRecord: true,
      consentToPublish: true,
      supportedRegionConfirmed: true,
      phoneReviewed: true,
      fictionalDataConfirmed: true,
      authorizedAt: "2026-08-08T12:02:00.000Z",
      authorizationDigest: `sha256:${"a".repeat(64)}`,
    } as const);
    const store = new MemoryRunStore(
      createAwaitingRun({ authorization: existingAuthorization }),
    );

    await expectBoundedAuthorizationError(
      authorizeRun(
        { store, clock },
        {
          runId: "run-001",
          expectedVersion: 4,
          approval: validApproval,
        },
      ),
    );
    expect(store.swaps).toHaveLength(0);
  });

  it("does not use the private phone number as digest input", async () => {
    const firstStore = new MemoryRunStore(createAwaitingRun());
    const secondPhone = "+13035550123";
    const secondStore = new MemoryRunStore(
      createAwaitingRun({
        recipient: {
          ...createAwaitingRun().recipient,
          phoneE164: secondPhone,
          maskedPhone: "+1 ***-***-0123",
        },
      }),
    );

    const first = await authorizeRun(
      { store: firstStore, clock },
      { runId: "run-001", expectedVersion: 4, approval: validApproval },
    );
    const second = await authorizeRun(
      { store: secondStore, clock },
      { runId: "run-001", expectedVersion: 4, approval: validApproval },
    );

    expect(first.authorization?.authorizationDigest).toBe(
      second.authorization?.authorizationDigest,
    );
    expect(first.authorization?.authorizationDigest).not.toContain(fullPhone);
    expect(second.authorization?.authorizationDigest).not.toContain(
      secondPhone,
    );
  });

  it("binds the digest to the run identifier", async () => {
    const firstStore = new MemoryRunStore(createAwaitingRun());
    const secondStore = new MemoryRunStore(
      createAwaitingRun({ id: "run-002" }),
    );

    const first = await authorizeRun(
      { store: firstStore, clock },
      { runId: "run-001", expectedVersion: 4, approval: validApproval },
    );
    const second = await authorizeRun(
      { store: secondStore, clock },
      {
        runId: "run-002",
        expectedVersion: 4,
        approval: { ...validApproval, runId: "run-002" },
      },
    );

    expect(first.authorization?.authorizationDigest).not.toBe(
      second.authorization?.authorizationDigest,
    );
  });

  it("canonicalizes caller input and never invokes accessors", async () => {
    const store = new MemoryRunStore(createAwaitingRun());
    let getterCalls = 0;
    const approval = { ...validApproval };
    Object.defineProperty(approval, "phoneReviewed", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });

    await expectBoundedAuthorizationError(
      authorizeRun(
        { store, clock },
        { runId: "run-001", expectedVersion: 4, approval },
      ),
    );
    expect(getterCalls).toBe(0);
    expect(store.swaps).toHaveLength(0);
  });

  it("maps a compare-and-swap race to a bounded error", async () => {
    const store = new MemoryRunStore(
      createAwaitingRun(),
      new Error(`stale ${fullPhone}`),
    );

    await expectBoundedAuthorizationError(
      authorizeRun(
        { store, clock },
        { runId: "run-001", expectedVersion: 4, approval: validApproval },
      ),
    );
    expect(store.swaps).toHaveLength(1);
  });

  it("does not mutate the approval object", async () => {
    const store = new MemoryRunStore(createAwaitingRun());
    const approval = structuredClone(validApproval);
    const before = structuredClone(approval);

    const result = await authorizeRun(
      { store, clock },
      { runId: "run-001", expectedVersion: 4, approval },
    );
    approval.phoneReviewed = false;

    expect(before).toEqual(validApproval);
    expect(result.authorization?.phoneReviewed).toBe(true);
  });
});
