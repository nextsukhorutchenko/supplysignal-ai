import { z } from "zod";

import type { RunRecord } from "./run.js";

const TRUST_STATUSES = [
  "UNVERIFIED_PROVIDER_RESULT",
  "CONSISTENCY_CHECK_PASSED",
  "HUMAN_CONFIRMED",
  "CONFLICT_DETECTED",
  "OUTCOME_UNKNOWN",
] as const;

export type TrustStatus = (typeof TRUST_STATUSES)[number];

export const trustStatusSchema = z.enum(TRUST_STATUSES);

export function canCompleteRun(run: RunRecord): boolean {
  return (
    run.status === "PROVIDER_REPORTED_TERMINAL" &&
    run.schemaValidation === "passed" &&
    run.consistencyValidation === "passed" &&
    run.trustStatus === "HUMAN_CONFIRMED" &&
    run.artifactState === "published"
  );
}
