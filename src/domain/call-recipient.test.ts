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

const ukraineLowerBoundary = ["+380", "100", "000", "000"].join("");
const ukraineUpperBoundary = ["+380", "999", "999", "999"].join("");

const validUkraineEnglishRecipient = {
  recipientName: "Consenting participant",
  phoneE164: ukraineLowerBoundary,
  maskedPhone: "+380 **-***-0000",
  region: "UA",
  locale: "en-UA",
} as const;

const validUkraineUkrainianRecipient = {
  ...validUkraineEnglishRecipient,
  locale: "uk-UA",
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
    ["English", validUkraineEnglishRecipient],
    ["Ukrainian", validUkraineUkrainianRecipient],
  ] as const)(
    "creates the canonical Ukraine %s recipient",
    (language, expected) => {
      expect(
        createCallRecipient({
          recipientName: "  Consenting participant  ",
          phoneE164: ukraineLowerBoundary,
          language,
        }),
      ).toEqual(expected);
      expect(getCallRecipientPresentation(expected)).toEqual({
        country: "Ukraine",
        language,
      });
    },
  );

  it("uses the deterministic Ukraine mask", () => {
    expect(maskPhoneNumber(ukraineUpperBoundary)).toBe("+380 **-***-9999");
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

  it.each([
    ["local format", ["0", "67", "000", "0000"].join("")],
    ["zero national prefix", ["+380", "000", "000", "000"].join("")],
    ["too short", ["+380", "100", "000", "00"].join("")],
    ["too long", ["+380", "100", "000", "000", "0"].join("")],
    ["spaces", ["+380 ", "100 ", "000 000"].join("")],
    ["hyphens", ["+380-", "100-", "000-000"].join("")],
    ["extension", ["+380", "100", "000", "000", "x1"].join("")],
  ])("rejects Ukraine %s before canonicalization", (_case, phoneE164) => {
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164,
        language: "Ukrainian",
      }),
    ).toThrow();
  });

  it("requires an exact Ukraine language", () => {
    for (const language of [undefined, "ukrainian", "Ukrainian ", "French"]) {
      try {
        createCallRecipient({
          recipientName: "Consenting participant",
          phoneE164: ukraineLowerBoundary,
          ...(language === undefined ? {} : { language }),
        });
        throw new Error("Expected Ukraine language rejection");
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: "UNSUPPORTED_RECIPIENT_LANGUAGE" });
      }
    }
  });

  it.each([
    [validRecipient.phoneE164, "English"],
    [kenyaLowerBoundary, "English"],
  ] as const)("rejects a language override for %s", (phoneE164, language) => {
    try {
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164,
        language,
      });
      throw new Error("Expected language override rejection");
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: "UNSUPPORTED_RECIPIENT_LANGUAGE",
      });
    }
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
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164: ukraineLowerBoundary,
        language: "English",
        region: "US",
        locale: "en-US",
      }),
    ).toThrow();
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164: ukraineLowerBoundary,
        language: "English",
        region: "KE",
        locale: "en-KE",
      }),
    ).toThrow();
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164: ukraineLowerBoundary,
        language: "English",
        locale: "uk-UA",
      }),
    ).toThrow();
    expect(() =>
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164: ukraineLowerBoundary,
        language: "Ukrainian",
        locale: "en-UA",
      }),
    ).toThrow();
    expect(() =>
      callRecipientSchema.parse({
        ...validRecipient,
        region: "UA",
        locale: "en-UA",
      }),
    ).toThrow();
    expect(() =>
      callRecipientSchema.parse({
        ...validKenyaRecipient,
        region: "UA",
        locale: "uk-UA",
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

  it("rejects a malformed Ukraine phone without disclosing it", () => {
    const phoneE164 = ["+380", "000", "000", "000"].join("");
    const result = callRecipientSchema.safeParse({
      ...validUkraineUkrainianRecipient,
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

  it("rejects an accessor-backed Ukraine language without reading its getter", () => {
    let calls = 0;
    const input = {
      recipientName: "Consenting participant",
      phoneE164: ukraineLowerBoundary,
    };
    Object.defineProperty(input, "language", {
      enumerable: true,
      get() {
        calls += 1;
        return "Ukrainian";
      },
    });

    expect(() => createCallRecipient(input)).toThrow();
    expect(calls).toBe(0);
  });
});
