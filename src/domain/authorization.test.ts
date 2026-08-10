import { describe, expect, it } from "vitest";

import { callAuthorizationSchema } from "./authorization.js";

const validAuthorization = {
  consentToCall: true,
  consentToRecord: true,
  consentToPublish: true,
  supportedRegionConfirmed: true,
  phoneReviewed: true,
  fictionalDataConfirmed: true,
  authorizedAt: "2026-08-08T12:00:00.000Z",
  authorizationDigest: "authorization-digest-v1",
} as const;

describe("callAuthorizationSchema", () => {
  it("accepts a fully approved one-call authorization", () => {
    expect(callAuthorizationSchema.parse(validAuthorization)).toEqual(
      validAuthorization,
    );
  });

  it.each([
    "consentToCall",
    "consentToRecord",
    "consentToPublish",
    "supportedRegionConfirmed",
    "phoneReviewed",
    "fictionalDataConfirmed",
  ] as const)("rejects authorization when %s is not literal true", (flag) => {
    expect(
      callAuthorizationSchema.safeParse({
        ...validAuthorization,
        [flag]: false,
      }),
    ).toMatchObject({ success: false });
  });

  it("rejects unknown fields, invalid timestamps, and blank digests", () => {
    expect(
      callAuthorizationSchema.safeParse({
        ...validAuthorization,
        authorizedAt: "2026-02-30T12:00:00.000Z",
      }),
    ).toMatchObject({ success: false });
    expect(
      callAuthorizationSchema.safeParse({
        ...validAuthorization,
        authorizationDigest: "   ",
      }),
    ).toMatchObject({ success: false });
    expect(
      callAuthorizationSchema.safeParse({
        ...validAuthorization,
        unexpected: true,
      }),
    ).toMatchObject({ success: false });
  });
});
