import { AppError } from "../domain/errors.js";
import {
  providerEvidenceSnapshotSchema,
  runRecordSchema,
  transitionRun,
  type ProviderEvidenceSnapshot,
  type RunRecord,
  type RunStatus,
} from "../domain/run.js";
import { deriveCallIdentity } from "./idempotency.js";
import type {
  CalleGateway,
  Clock,
  CreateSupplierCall,
  RunStore,
} from "./ports.js";

export type ReconcileRunDependencies = {
  store: RunStore;
  calle: CalleGateway;
  clock: Clock;
};

const ACTIVE_STATUSES = new Set<RunStatus>([
  "CALL_STARTING",
  "CALL_IN_PROGRESS",
  "RECONCILING",
]);

function bounded(code: ConstructorParameters<typeof AppError>[0]): AppError {
  return new AppError(code);
}

function safeNow(clock: Clock): string {
  try {
    return clock.now();
  } catch {
    throw bounded("CALL_OUTCOME_PENDING");
  }
}

async function readActiveRun(
  store: RunStore,
  runId: string,
): Promise<RunRecord> {
  try {
    const run = runRecordSchema.parse(await store.read(runId));
    if (run.authorization === undefined) {
      throw bounded("AUTHORIZATION_REQUIRED");
    }
    return run;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    throw bounded("CALL_OUTCOME_PENDING");
  }
}

function createInput(run: RunRecord): CreateSupplierCall {
  if (
    run.idempotencyKey === undefined ||
    run.requestDigest === undefined ||
    run.authorization === undefined
  ) {
    throw bounded("CALL_OUTCOME_PENDING");
  }
  let identity: ReturnType<typeof deriveCallIdentity>;
  try {
    identity = deriveCallIdentity(run);
  } catch {
    throw bounded("CALL_OUTCOME_PENDING");
  }
  if (
    identity.idempotencyKey !== run.idempotencyKey ||
    identity.requestDigest !== run.requestDigest
  ) {
    throw bounded("PROVIDER_RESULT_CONFLICT");
  }
  return {
    runId: run.id,
    idempotencyKey: run.idempotencyKey,
    order: run.order,
    recipient: run.recipient,
  };
}

async function compareAndSwap(
  store: RunStore,
  current: RunRecord,
  next: RunRecord,
): Promise<RunRecord> {
  try {
    return runRecordSchema.parse(
      await store.compareAndSwap(current.id, current.version, next),
    );
  } catch {
    const winner = await readActiveRun(store, current.id);
    if (winner.version <= current.version) {
      throw bounded("CALL_OUTCOME_PENDING");
    }
    if (
      winner.idempotencyKey !== current.idempotencyKey ||
      winner.requestDigest !== current.requestDigest
    ) {
      throw bounded("PROVIDER_RESULT_CONFLICT");
    }
    if (
      current.callId !== undefined &&
      winner.callId !== undefined &&
      current.callId !== winner.callId
    ) {
      throw bounded("PROVIDER_RESULT_CONFLICT");
    }
    return winner;
  }
}

async function persistStatus(
  dependencies: ReconcileRunDependencies,
  current: RunRecord,
  status: RunStatus,
  snapshot?: ProviderEvidenceSnapshot,
): Promise<RunRecord> {
  const base =
    current.status === status
      ? { ...current, version: current.version + 1 }
      : transitionRun(current, status);
  const next = runRecordSchema.parse({
    ...base,
    ...(snapshot === undefined
      ? {}
      : {
          callId: current.callId ?? snapshot.callId,
          providerSnapshot: snapshot,
        }),
    updatedAt: safeNow(dependencies.clock),
  });
  return compareAndSwap(dependencies.store, current, next);
}

async function ensureReconciliationState(
  dependencies: ReconcileRunDependencies,
  current: RunRecord,
): Promise<RunRecord> {
  if (current.status === "RECONCILING") {
    return current;
  }
  if (
    current.status === "CALL_STARTING" ||
    current.status === "CALL_IN_PROGRESS"
  ) {
    return persistStatus(dependencies, current, "RECONCILING");
  }
  return current;
}

function mappedStatus(status: ProviderEvidenceSnapshot["status"]): RunStatus {
  switch (status) {
    case "queued":
      return "CALL_STARTING";
    case "in_progress":
      return "CALL_IN_PROGRESS";
    case "completed":
      return "PROVIDER_REPORTED_TERMINAL";
    case "failed":
    case "canceled":
      return "FAILED";
    case "unknown":
      return "OUTCOME_UNKNOWN";
  }
}

export async function persistProviderSnapshot(
  dependencies: ReconcileRunDependencies,
  current: RunRecord,
  input: unknown,
): Promise<RunRecord> {
  let snapshot: ProviderEvidenceSnapshot;
  try {
    snapshot = providerEvidenceSnapshotSchema.parse(input);
  } catch {
    throw bounded("PROVIDER_RESULT_INVALID");
  }

  if (current.callId !== undefined && current.callId !== snapshot.callId) {
    const reconciling = await ensureReconciliationState(dependencies, current);
    return persistStatus(dependencies, reconciling, "OUTCOME_UNKNOWN");
  }

  const withIdentity =
    current.callId === undefined
      ? runRecordSchema.parse({ ...current, callId: snapshot.callId })
      : current;
  const target = mappedStatus(snapshot.status);
  let base = withIdentity;
  if (
    (target === "PROVIDER_REPORTED_TERMINAL" ||
      target === "OUTCOME_UNKNOWN" ||
      (target === "CALL_STARTING" && current.status === "CALL_IN_PROGRESS")) &&
    base.status !== "RECONCILING"
  ) {
    base = await ensureReconciliationState(dependencies, base);
  }
  return persistStatus(dependencies, base, target, snapshot);
}

async function persistPending(
  dependencies: ReconcileRunDependencies,
  current: RunRecord,
): Promise<never> {
  await ensureReconciliationState(dependencies, current);
  throw bounded("CALL_OUTCOME_PENDING");
}

export async function reconcileRun(
  dependencies: ReconcileRunDependencies,
  runId: string,
): Promise<RunRecord> {
  const current = await readActiveRun(dependencies.store, runId);
  if (!ACTIVE_STATUSES.has(current.status)) {
    return current;
  }

  let snapshot: ProviderEvidenceSnapshot;
  if (current.callId !== undefined) {
    try {
      snapshot = await dependencies.calle.getCall(current.callId);
    } catch (error: unknown) {
      if (
        error instanceof AppError &&
        error.code === "PROVIDER_RESULT_INVALID"
      ) {
        throw bounded("PROVIDER_RESULT_INVALID");
      }
      return persistPending(dependencies, current);
    }
  } else {
    const input = createInput(current);
    try {
      snapshot = await dependencies.calle.createCall(input);
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "CALL_CREATION_FAILED") {
        await ensureReconciliationState(dependencies, current);
        throw bounded("CALL_CREATION_FAILED");
      }
      return persistPending(dependencies, current);
    }
  }

  return persistProviderSnapshot(dependencies, current, snapshot);
}
