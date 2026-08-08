import { describe, expect, it } from "vitest";

import { runRecordSchema, type RunRecord } from "../domain/run.js";
import { createRun } from "./create-run.js";
import type { Clock, IdGenerator, RunStore } from "./ports.js";

const fullPhone = "+12025550123";

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

class RecordingRunStore implements RunStore {
  readonly created: RunRecord[] = [];

  async create(run: RunRecord): Promise<void> {
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
  it("creates and persists one valid private draft run", async () => {
    const store = new RecordingRunStore();

    const run = await createRun({ store, clock, ids }, validInput);

    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toBe(run);
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
  });

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
