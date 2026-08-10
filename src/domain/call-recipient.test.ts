import { describe, expect, it } from "vitest";

import {
  callRecipientSchema,
  createCallRecipient,
  maskPhoneNumber,
} from "./call-recipient.js";

const validRecipient = {
  recipientName: "Jordan Lee",
  phoneE164: "+14155551234",
  maskedPhone: "+1 ***-***-1234",
  region: "US",
  locale: "en-US",
} as const;

describe("call recipients", () => {
  it("creates the deterministic masked representation for a valid US recipient", () => {
    expect(maskPhoneNumber("+14155551234")).toBe("+1 ***-***-1234");
    expect(
      createCallRecipient({
        recipientName: "  Jordan Lee  ",
        phoneE164: "+14155551234",
        region: "US",
        locale: "en-US",
      }),
    ).toEqual(validRecipient);
  });

  it.each(["+11155551234", "+44155551234", "+1415555123", "14155551234"])(
    "rejects a phone number outside the approved US E.164 format: %s",
    (phoneE164) => {
      expect(() =>
        callRecipientSchema.parse({ ...validRecipient, phoneE164 }),
      ).toThrow();
    },
  );

  it("requires an exact region, locale, and matching masked representation", () => {
    expect(() =>
      callRecipientSchema.parse({ ...validRecipient, region: "CA" }),
    ).toThrow();
    expect(() =>
      callRecipientSchema.parse({ ...validRecipient, locale: "en-GB" }),
    ).toThrow();
    expect(() =>
      callRecipientSchema.parse({
        ...validRecipient,
        maskedPhone: "+1 ***-***-9999",
      }),
    ).toThrow();
  });

  it("rejects an empty, overlong, or unknown recipient field", () => {
    expect(() =>
      createCallRecipient({
        recipientName: " ",
        phoneE164: validRecipient.phoneE164,
        region: "US",
        locale: "en-US",
      }),
    ).toThrow();
    expect(() =>
      createCallRecipient({
        recipientName: "x".repeat(121),
        phoneE164: validRecipient.phoneE164,
        region: "US",
        locale: "en-US",
        extra: true,
      }),
    ).toThrow();
  });
});
