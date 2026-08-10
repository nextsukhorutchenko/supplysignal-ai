import { describe, expect, it } from "vitest";

import { AppError } from "../domain/errors.js";
import { runRecordSchema, type RunRecord } from "../domain/run.js";
import { createRun } from "./create-run.js";
import type { Clock, IdGenerator, RunStore } from "./ports.js";

const fullPhone = "+12025550123";
const canonicalUsPhone = ["+1", "202", "555", "0123"].join("");
const canonicalKenyaPhone = ["+254", "100", "000", "000"].join("");
const sensitiveDependencyError = new Error(
  `${fullPhone} C:\\private\\operator\\runs internal dependency detail`,
);

const validInput = {
  order: {
    supplierName: "Northstar Components",
    purchaseOrderRef: "PO-2048",
    expectedQuantity: 500,
    requiredDeliveryDate: "2026-08-15",
  },
  recipient: {
    recipientName: "Consenting participant",
    phoneE164: fullPhone,
    region: "US",
    locale: "en-US",
  },
};

const canonicalUsRecipient = {
  recipientName: "Consenting participant",
  phoneE164: canonicalUsPhone,
  maskedPhone: "+1 ***-***-0123",
  region: "US",
  locale: "en-US",
} as const;

const canonicalKenyaRecipient = {
  recipientName: "Consenting participant",
  phoneE164: canonicalKenyaPhone,
  maskedPhone: "+254 ***-**-0000",
  region: "KE",
  locale: "en-KE",
} as const;

class RecordingRunStore implements RunStore {
  readonly created: RunRecord[] = [];

  constructor(private readonly createError?: Error) {}

  async create(run: RunRecord): Promise<void> {
    if (this.createError !== undefined) {
      throw this.createError;
    }
    this.created.push(run);
  }

  async read(): Promise<RunRecord> {
    throw new Error("read is not used by createRun");
  }

  async compareAndSwap(): Promise<RunRecord> {
    throw new Error("compareAndSwap is not used by createRun");
  }
}

const clock: Clock = {
  now: () => "2026-08-08T12:00:00.000Z",
  sleep: async () => undefined,
};

const ids: IdGenerator = { next: () => "run-001" };

describe("createRun", () => {
  it.each([
    ["United States", canonicalUsRecipient],
    ["Kenya", canonicalKenyaRecipient],
  ] as const)(
    "accepts and persists an exact canonical %s recipient",
    async (_profile, recipient) => {
      const store = new RecordingRunStore();

      const run = await createRun(
        { store, clock, ids },
        { order: validInput.order, recipient },
      );

      expect(run.recipient).toEqual(recipient);
      expect(store.created).toHaveLength(1);
      expect(store.created[0]?.recipient).toEqual(recipient);
      expect(run.recipient).not.toBe(recipient);
      expect(store.created[0]?.recipient).not.toBe(recipient);
      expect(store.created[0]?.recipient).not.toBe(run.recipient);
    },
  );

  it.each([
    [
      "invalid canonical mask",
      { ...canonicalUsRecipient, maskedPhone: "+1 ***-***-9999" },
    ],
    [
      "cross-profile canonical values",
      {
        ...canonicalKenyaRecipient,
        region: "US",
        locale: "en-US",
      },
    ],
    [
      "extra canonical field",
      { ...canonicalUsRecipient, unexpected: "not permitted" },
    ],
  ])("rejects %s before persistence", async (_case, recipient) => {
    const store = new RecordingRunStore();

    await expect(
      createRun({ store, clock, ids }, { order: validInput.order, recipient }),
    ).rejects.toThrow("Expected safe plain JSON data");
    expect(store.created).toHaveLength(0);
  });

  it("rejects an accessor-backed canonical recipient without reading it", async () => {
    const store = new RecordingRunStore();
    let getterCalls = 0;
    const recipient = { ...canonicalUsRecipient };
    Object.defineProperty(recipient, "maskedPhone", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return canonicalUsRecipient.maskedPhone;
      },
    });

    await expect(
      createRun({ store, clock, ids }, { order: validInput.order, recipient }),
    ).rejects.toThrow("Expected safe plain JSON data");
    expect(getterCalls).toBe(0);
    expect(store.created).toHaveLength(0);
  });

  it("creates separate validated graphs for persistence and the caller", async () => {
    const store = new RecordingRunStore();

    const run = await createRun({ store, clock, ids }, validInput);

    expect(store.created).toHaveLength(1);
    expect(store.created[0]).not.toBe(run);
    expect(store.created[0]?.order).not.toBe(run.order);
    expect(store.created[0]?.recipient).not.toBe(run.recipient);
    expect(run).toEqual({
      id: "run-001",
      version: 0,
      status: "DRAFT",
      trustStatus: "UNVERIFIED_PROVIDER_RESULT",
      order: validInput.order,
      recipient: {
        ...validInput.recipient,
        maskedPhone: "+1 ***-***-0123",
      },
      schemaValidation: "not_run",
      consistencyValidation: "not_run",
      artifactState: "none",
      createdAt: "2026-08-08T12:00:00.000Z",
      updatedAt: "2026-08-08T12:00:00.000Z",
    });
    expect(runRecordSchema.safeParse(run).success).toBe(true);
    expect(runRecordSchema.safeParse(store.created[0]).success).toBe(true);

    const stored = store.created[0];
    if (stored === undefined) {
      throw new Error("Expected one stored run");
    }
    stored.order.supplierName = "Mutated stored supplier";
    stored.recipient.recipientName = "Mutated stored recipient";
    expect(run.order.supplierName).toBe("Northstar Components");
    expect(run.recipient.recipientName).toBe("Consenting participant");

    run.order.purchaseOrderRef = "MUTATED-RETURNED";
    run.recipient.maskedPhone = "+1 ***-***-9999";
    expect(stored.order.purchaseOrderRef).toBe("PO-2048");
    expect(stored.recipient.maskedPhone).toBe("+1 ***-***-0123");
  });

  it.each([
    [
      "Clock.now",
      () => ({
        store: new RecordingRunStore(),
        clock: {
          ...clock,
          now: () => {
            throw sensitiveDependencyError;
          },
        },
        ids,
      }),
    ],
    [
      "IdGenerator.next",
      () => ({
        store: new RecordingRunStore(),
        clock,
        ids: {
          next: () => {
            throw sensitiveDependencyError;
          },
        },
      }),
    ],
    [
      "RunStore.create",
      () => ({
        store: new RecordingRunStore(sensitiveDependencyError),
        clock,
        ids,
      }),
    ],
  ] as const)(
    "bounds a sensitive %s failure",
    async (_dependency, makeDeps) => {
      try {
        await createRun(makeDeps(), validInput);
        throw new Error("Expected createRun to reject");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({
          code: "RUN_CREATION_FAILED",
          message: "RUN_CREATION_FAILED",
        });
        const exposed = `${String(error)} ${JSON.stringify(error)}`;
        expect(exposed).not.toContain(fullPhone);
        expect(exposed).not.toContain("C:\\private\\operator\\runs");
        expect(exposed).not.toContain("internal dependency detail");
      }
    },
  );

  it("keeps the full number private and exposes only its masked display value", async () => {
    const store = new RecordingRunStore();

    const run = await createRun({ store, clock, ids }, validInput);

    expect(run.recipient.phoneE164).toBe(fullPhone);
    expect(run.recipient.maskedPhone).toBe("+1 ***-***-0123");
    expect(run.recipient.maskedPhone).not.toContain(fullPhone);
  });

  it("rejects malformed or behavior-bearing input before persisting it", async () => {
    const store = new RecordingRunStore();
    let getterCalls = 0;
    const input = { ...validInput };
    Object.defineProperty(input, "order", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return validInput.order;
      },
    });

    await expect(createRun({ store, clock, ids }, input)).rejects.toThrow(
      "Expected safe plain JSON data",
    );
    expect(getterCalls).toBe(0);
    expect(store.created).toHaveLength(0);

    await expect(
      createRun(
        { store, clock, ids },
        {
          ...validInput,
          order: { ...validInput.order, purchaseOrderRef: fullPhone },
          unexpected: fullPhone,
        },
      ),
    ).rejects.toThrow("Expected safe plain JSON data");
    expect(store.created).toHaveLength(0);
  });

  it("does not mutate caller-owned input", async () => {
    const store = new RecordingRunStore();
    const input = structuredClone(validInput);
    const before = structuredClone(input);

    await createRun({ store, clock, ids }, input);

    expect(input).toEqual(before);
    expect(input.recipient).not.toHaveProperty("maskedPhone");
  });
});
