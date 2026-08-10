import { describe, expect, it } from "vitest";

import {
  callRecipientSchema,
  createCallRecipient,
  getCallRecipientPresentation,
  maskPhoneNumber,
} from "./call-recipient.js";

const validRecipient = {
  recipientName: "Jordan Lee",
  phoneE164: "+14155551234",
  maskedPhone: "+1 ***-***-1234",
  region: "US",
  locale: "en-US",
} as const;

const kenyaLowerBoundary = ["+254", "100", "000", "000"].join("");
const kenyaUpperBoundary = ["+254", "999", "999", "999"].join("");

const validKenyaRecipient = {
  recipientName: "Consenting participant",
  phoneE164: kenyaLowerBoundary,
  maskedPhone: "+254 ***-**-0000",
  region: "KE",
  locale: "en-KE",
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
    expect(getCallRecipientPresentation(validRecipient)).toEqual({
      country: "United States",
      language: "English",
    });
  });

  it("creates the canonical Kenya English recipient from the phone", () => {
    expect(
      createCallRecipient({
        recipientName: "  Consenting participant  ",
        phoneE164: kenyaLowerBoundary,
      }),
    ).toEqual(validKenyaRecipient);
    expect(maskPhoneNumber(kenyaUpperBoundary)).toBe("+254 ***-**-9999");
    expect(getCallRecipientPresentation(validKenyaRecipient)).toEqual({
      country: "Kenya",
      language: "English",
    });
  });

  it.each([
    ["local format", ["07", "00", "000", "000"].join("")],
    ["zero national prefix", ["+254", "000", "000", "000"].join("")],
    ["too short", ["+254", "100", "000", "00"].join("")],
    ["too long", ["+254", "100", "000", "000", "0"].join("")],
    ["spaces", ["+254 ", "100 ", "000 000"].join("")],
    ["extension", ["+254", "100", "000", "000", "x1"].join("")],
  ])("rejects Kenya %s before canonicalization", (_case, phoneE164) => {
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164,
      }),
    ).toThrow();
  });

  it("rejects every cross-profile region and locale pair", () => {
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164: kenyaLowerBoundary,
        region: "US",
        locale: "en-US",
      }),
    ).toThrow();
    expect(() =>
      callRecipientSchema.parse({
        ...validKenyaRecipient,
        locale: "en-US",
      }),
    ).toThrow();
  });

  it.each([
    ["an unsupported generic phone", ["+44", "155", "555", "1234"].join("")],
    ["a malformed Kenya phone", ["+254", "000", "000", "000"].join("")],
  ])("safeParse rejects %s without disclosing it", (_case, phoneE164) => {
    const result = callRecipientSchema.safeParse({
      ...validKenyaRecipient,
      phoneE164,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error)).not.toContain(phoneE164);
      expect(result.error.message).not.toContain(phoneE164);
    }
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

  it("rejects an accessor-backed Kenya phone without reading its getter", () => {
    let calls = 0;
    const input = { recipientName: "Consenting participant" };
    Object.defineProperty(input, "phoneE164", {
      enumerable: true,
      get() {
        calls += 1;
        return kenyaLowerBoundary;
      },
    });

    expect(() => createCallRecipient(input)).toThrow();
    expect(calls).toBe(0);
  });
});
