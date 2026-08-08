import { z } from "zod";

import { createCallRecipient } from "../domain/call-recipient.js";
import { AppError } from "../domain/errors.js";
import { withPlainDataBoundary } from "../domain/plain-data.js";
import { purchaseOrderSchema } from "../domain/purchase-order.js";
import { runRecordSchema, type RunRecord } from "../domain/run.js";
import type { Clock, IdGenerator, RunStore } from "./ports.js";

const createRunInputSchema = withPlainDataBoundary(
  z.strictObject({
    order: purchaseOrderSchema,
    recipient: z.unknown(),
  }),
);

export type CreateRunDependencies = {
  store: RunStore;
  clock: Clock;
  ids: IdGenerator;
};

export async function createRun(
  dependencies: CreateRunDependencies,
  input: unknown,
): Promise<RunRecord> {
  const parsed = createRunInputSchema.parse(input);
  const recipient = createCallRecipient(parsed.recipient);

  try {
    const timestamp = dependencies.clock.now();
    const candidate = {
      id: dependencies.ids.next(),
      version: 0,
      status: "DRAFT",
      trustStatus: "UNVERIFIED_PROVIDER_RESULT",
      order: parsed.order,
      recipient,
      schemaValidation: "not_run",
      consistencyValidation: "not_run",
      artifactState: "none",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const storedRun = runRecordSchema.parse(candidate);
    const returnedRun = runRecordSchema.parse(candidate);

    await dependencies.store.create(storedRun);
    return returnedRun;
  } catch {
    throw new AppError("RUN_CREATION_FAILED");
  }
}
