import { createHash } from "node:crypto";

import { z } from "zod";

import { callAuthorizationSchema } from "../domain/authorization.js";
import { AppError } from "../domain/errors.js";
import { withPlainDataBoundary } from "../domain/plain-data.js";
import { runRecordSchema, type RunRecord } from "../domain/run.js";
import type { Clock, RunStore } from "./ports.js";

const MAX_RUN_ID_LENGTH = 128;

const approvalSchema = z.strictObject({
  runId: z.string().trim().min(1).max(MAX_RUN_ID_LENGTH),
  formRevision: z.number().int().nonnegative(),
  consentToCall: z.boolean(),
  consentToRecord: z.boolean(),
  consentToPublish: z.boolean(),
  supportedRegionConfirmed: z.boolean(),
  phoneReviewed: z.boolean(),
  fictionalDataConfirmed: z.boolean(),
});

const authorizeRunInputSchema = withPlainDataBoundary(
  z.strictObject({
    runId: z.string().trim().min(1).max(MAX_RUN_ID_LENGTH),
    expectedVersion: z.number().int().nonnegative(),
    approval: approvalSchema,
  }),
);

type ParsedAuthorizationInput = z.infer<typeof authorizeRunInputSchema>;

export type AuthorizeRunDependencies = {
  store: RunStore;
  clock: Clock;
};

function authorizationRequired(): AppError {
  return new AppError("AUTHORIZATION_REQUIRED");
}

function parseInput(input: unknown): ParsedAuthorizationInput {
  const parsed = authorizeRunInputSchema.safeParse(input);
  if (!parsed.success) {
    throw authorizationRequired();
  }
  return parsed.data;
}

async function readCurrent(store: RunStore, runId: string): Promise<RunRecord> {
  try {
    return runRecordSchema.parse(await store.read(runId));
  } catch {
    throw authorizationRequired();
  }
}

function hasEveryConfirmation(
  approval: ParsedAuthorizationInput["approval"],
): boolean {
  return (
    approval.consentToCall &&
    approval.consentToRecord &&
    approval.consentToPublish &&
    approval.phoneReviewed &&
    approval.fictionalDataConfirmed
  );
}

function authorizationDigest(
  approval: ParsedAuthorizationInput["approval"],
): string {
  const canonicalPayload = JSON.stringify({
    version: 1,
    runId: approval.runId,
    formRevision: approval.formRevision,
    confirmations: {
      consentToCall: approval.consentToCall,
      consentToRecord: approval.consentToRecord,
      consentToPublish: approval.consentToPublish,
      supportedRegionConfirmed: approval.supportedRegionConfirmed,
      phoneReviewed: approval.phoneReviewed,
      fictionalDataConfirmed: approval.fictionalDataConfirmed,
    },
  });

  return `sha256:${createHash("sha256").update(canonicalPayload).digest("hex")}`;
}

function freezeAuthorization(run: RunRecord): RunRecord {
  if (run.authorization === undefined) {
    throw authorizationRequired();
  }

  return {
    ...run,
    authorization: Object.freeze(run.authorization),
  };
}

export async function authorizeRun(
  dependencies: AuthorizeRunDependencies,
  input: unknown,
): Promise<RunRecord> {
  const parsed = parseInput(input);
  const current = await readCurrent(dependencies.store, parsed.runId);

  if (!parsed.approval.supportedRegionConfirmed) {
    throw new AppError("UNSUPPORTED_RECIPIENT_REGION");
  }

  if (
    !hasEveryConfirmation(parsed.approval) ||
    parsed.approval.runId !== parsed.runId ||
    parsed.approval.formRevision !== current.version ||
    parsed.expectedVersion !== current.version ||
    current.id !== parsed.runId ||
    current.status !== "AWAITING_APPROVAL" ||
    current.authorization !== undefined
  ) {
    throw authorizationRequired();
  }

  const authorizedAt = dependencies.clock.now();
  const authorization = Object.freeze(
    callAuthorizationSchema.parse({
      consentToCall: true,
      consentToRecord: true,
      consentToPublish: true,
      supportedRegionConfirmed: true,
      phoneReviewed: true,
      fictionalDataConfirmed: true,
      authorizedAt,
      authorizationDigest: authorizationDigest(parsed.approval),
    }),
  );
  const next = freezeAuthorization(
    runRecordSchema.parse({
      ...current,
      authorization,
      version: current.version + 1,
      updatedAt: authorizedAt,
    }),
  );

  try {
    const persisted = await dependencies.store.compareAndSwap(
      current.id,
      parsed.expectedVersion,
      next,
    );
    return freezeAuthorization(runRecordSchema.parse(persisted));
  } catch {
    throw authorizationRequired();
  }
}
