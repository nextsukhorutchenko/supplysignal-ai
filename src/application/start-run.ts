import { AppError } from "../domain/errors.js";
import { isoTimestampSchema } from "../domain/authorization.js";
import { callRecipientSchema } from "../domain/call-recipient.js";
import { purchaseOrderSchema } from "../domain/purchase-order.js";
import {
  runRecordSchema,
  transitionRun,
  type RunRecord,
} from "../domain/run.js";
import { deriveCallIdentity } from "./idempotency.js";
import type {
  CalleGateway,
  Clock,
  CreateSupplierCall,
  RunStore,
} from "./ports.js";
import { persistProviderSnapshot, reconcileRun } from "./reconcile-run.js";

export type StartRunDependencies = {
  store: RunStore;
  calle: CalleGateway;
  clock: Clock;
};

function bounded(code: ConstructorParameters<typeof AppError>[0]): AppError {
  return new AppError(code);
}

function safeNow(clock: Clock): string {
  try {
    const parsed = isoTimestampSchema.safeParse(clock.now());
    if (!parsed.success) {
      throw bounded("CALL_OUTCOME_PENDING");
    }
    return parsed.data;
  } catch {
    throw bounded("CALL_OUTCOME_PENDING");
  }
}

async function readRun(store: RunStore, runId: string): Promise<RunRecord> {
  try {
    return runRecordSchema.parse(await store.read(runId));
  } catch {
    throw bounded("AUTHORIZATION_REQUIRED");
  }
}

function requireAuthorization(
  run: RunRecord,
): NonNullable<RunRecord["authorization"]> {
  if (run.authorization === undefined) {
    throw bounded("AUTHORIZATION_REQUIRED");
  }
  return run.authorization;
}

async function claimRun(
  dependencies: StartRunDependencies,
  current: RunRecord,
): Promise<RunRecord> {
  requireAuthorization(current);
  let identity: ReturnType<typeof deriveCallIdentity>;
  try {
    identity = deriveCallIdentity(current);
  } catch {
    throw bounded("AUTHORIZATION_REQUIRED");
  }
  const next = runRecordSchema.parse({
    ...transitionRun(current, "CALL_STARTING"),
    ...identity,
    updatedAt: safeNow(dependencies.clock),
  });

  try {
    return runRecordSchema.parse(
      await dependencies.store.compareAndSwap(
        current.id,
        current.version,
        next,
      ),
    );
  } catch {
    const winner = await readRun(dependencies.store, current.id);
    if (
      (winner.status === "CALL_STARTING" || winner.status === "RECONCILING") &&
      winner.idempotencyKey === identity.idempotencyKey &&
      winner.requestDigest === identity.requestDigest
    ) {
      throw bounded("CALL_OUTCOME_PENDING");
    }
    throw bounded("CALL_CREATION_FAILED");
  }
}

function createInput(run: RunRecord): CreateSupplierCall {
  const authorization = requireAuthorization(run);
  void authorization;
  let identity: ReturnType<typeof deriveCallIdentity>;
  try {
    identity = deriveCallIdentity(run);
  } catch {
    throw bounded("CALL_CREATION_FAILED");
  }
  if (
    run.idempotencyKey !== identity.idempotencyKey ||
    run.requestDigest !== identity.requestDigest
  ) {
    throw bounded("PROVIDER_RESULT_CONFLICT");
  }
  return {
    runId: run.id,
    idempotencyKey: identity.idempotencyKey,
    order: purchaseOrderSchema.parse(run.order),
    recipient: callRecipientSchema.parse(run.recipient),
  };
}

async function persistDefiniteFailure(
  dependencies: StartRunDependencies,
  current: RunRecord,
): Promise<RunRecord> {
  if (current.status === "FAILED") {
    return current;
  }
  const next = runRecordSchema.parse({
    ...transitionRun(current, "FAILED"),
    updatedAt: safeNow(dependencies.clock),
  });
  try {
    return runRecordSchema.parse(
      await dependencies.store.compareAndSwap(
        current.id,
        current.version,
        next,
      ),
    );
  } catch {
    const winner = await readRun(dependencies.store, current.id);
    if (
      winner.status === "FAILED" &&
      winner.idempotencyKey === current.idempotencyKey &&
      winner.requestDigest === current.requestDigest &&
      winner.callId === current.callId
    ) {
      return winner;
    }
    if (
      winner.callId !== undefined &&
      current.callId !== undefined &&
      winner.callId !== current.callId
    ) {
      throw bounded("PROVIDER_RESULT_CONFLICT");
    }
    throw bounded("CALL_OUTCOME_PENDING");
  }
}

async function persistReconciliation(
  dependencies: StartRunDependencies,
  current: RunRecord,
): Promise<void> {
  if (current.status === "RECONCILING") {
    return;
  }
  const next = runRecordSchema.parse({
    ...transitionRun(current, "RECONCILING"),
    updatedAt: safeNow(dependencies.clock),
  });
  try {
    await dependencies.store.compareAndSwap(current.id, current.version, next);
  } catch {
    // A concurrent reconciler retains the already-persisted one-call identity.
  }
}

async function startRunInternal(
  dependencies: StartRunDependencies,
  runId: string,
): Promise<RunRecord> {
  let current = await readRun(dependencies.store, runId);
  let ownsCreateAttempt = false;
  requireAuthorization(current);

  if (current.callId !== undefined) {
    return reconcileRun(dependencies, runId);
  }
  if (
    current.status !== "AWAITING_APPROVAL" &&
    current.status !== "CALL_STARTING" &&
    current.status !== "RECONCILING"
  ) {
    return current;
  }
  if (current.status === "AWAITING_APPROVAL") {
    current = await claimRun(dependencies, current);
    ownsCreateAttempt = true;
  }
  if (!ownsCreateAttempt) {
    throw bounded("CALL_OUTCOME_PENDING");
  }

  const input = createInput(current);
  try {
    const snapshot = await dependencies.calle.createCall(input);
    return persistProviderSnapshot(dependencies, current, snapshot);
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === "CALL_CREATION_FAILED") {
      await persistDefiniteFailure(dependencies, current);
      throw bounded("CALL_CREATION_FAILED");
    }
    if (error instanceof AppError && error.code === "PROVIDER_RESULT_INVALID") {
      await persistDefiniteFailure(dependencies, current);
      throw bounded("PROVIDER_RESULT_INVALID");
    }
    if (error instanceof AppError && error.code === "CALL_OUTCOME_PENDING") {
      await persistReconciliation(dependencies, current);
      throw bounded("CALL_OUTCOME_PENDING");
    }
    await persistDefiniteFailure(dependencies, current);
    throw bounded("CALL_CREATION_FAILED");
  }
}

export async function startRun(
  dependencies: StartRunDependencies,
  runId: string,
): Promise<RunRecord> {
  try {
    return await startRunInternal(dependencies, runId);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    throw bounded("CALL_OUTCOME_PENDING");
  }
}
