import { describe, expect, it } from "vitest";

import type { RunRecord } from "../domain/run.js";
import {
  deriveCallIdempotencyKey,
  deriveCallRequestDigest,
} from "./idempotency.js";

const fictionalPhone = ["+1", "202", "555", "0198"].join("");

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

describe("call idempotency identity", () => {
  it("derives the same request digest for byte-equivalent call facts", () => {
    const first = authorizedRun();
    const second = authorizedRun({
      order: {
        requiredDeliveryDate: "2026-08-15",
        expectedQuantity: 500,
        purchaseOrderRef: "PO-2048",
        supplierName: "Northstar Components",
      },
      recipient: {
        locale: "en-US",
        region: "US",
        maskedPhone: "+1 ***-***-0198",
        phoneE164: fictionalPhone,
        recipientName: "Consenting participant",
      },
    });

    expect(deriveCallRequestDigest(first)).toBe(
      deriveCallRequestDigest(second),
    );
  });

  it("binds one bounded key to the run, authorization, and request digests", () => {
    const run = authorizedRun();
    const requestDigest = deriveCallRequestDigest(run);
    const key = deriveCallIdempotencyKey({
      runId: run.id,
      authorizationDigest: run.authorization!.authorizationDigest,
      requestDigest,
    });

    expect(requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(key).toMatch(/^ssai-v1-[a-f0-9]{48}$/);
    expect(key.length).toBeLessThanOrEqual(255);
    expect(`${requestDigest}${key}`).not.toContain(fictionalPhone);
  });

  it("changes identity when the request or authorization changes", () => {
    const first = authorizedRun();
    const changedRequest = authorizedRun({
      order: { ...first.order, expectedQuantity: 501 },
    });
    const changedAuthorization = authorizedRun({
      authorization: {
        ...first.authorization!,
        authorizationDigest: `sha256:${"b".repeat(64)}`,
      },
    });

    const firstDigest = deriveCallRequestDigest(first);
    const changedRequestDigest = deriveCallRequestDigest(changedRequest);
    const firstKey = deriveCallIdempotencyKey({
      runId: first.id,
      authorizationDigest: first.authorization!.authorizationDigest,
      requestDigest: firstDigest,
    });
    const changedRequestKey = deriveCallIdempotencyKey({
      runId: changedRequest.id,
      authorizationDigest: changedRequest.authorization!.authorizationDigest,
      requestDigest: changedRequestDigest,
    });
    const changedAuthorizationKey = deriveCallIdempotencyKey({
      runId: changedAuthorization.id,
      authorizationDigest:
        changedAuthorization.authorization!.authorizationDigest,
      requestDigest: firstDigest,
    });

    expect(changedRequestDigest).not.toBe(firstDigest);
    expect(changedRequestKey).not.toBe(firstKey);
    expect(changedAuthorizationKey).not.toBe(firstKey);
  });
});
