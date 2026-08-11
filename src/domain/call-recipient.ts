import { z } from "zod";

import { withPlainDataBoundary } from "./plain-data.js";

const US_E164_PATTERN = /^\+1[2-9]\d{9}$/;
const KE_E164_PATTERN = /^\+254[1-9]\d{8}$/;
const UA_E164_PATTERN = /^\+380[1-9]\d{8}$/;
const US_MASKED_PHONE_PATTERN = /^\+1 \*\*\*-\*\*\*-\d{4}$/;
const KE_MASKED_PHONE_PATTERN = /^\+254 \*\*\*-\*\*-\d{4}$/;
const UA_MASKED_PHONE_PATTERN = /^\+380 \*\*-\*\*\*-\d{4}$/;

export type RecipientLanguage = "English" | "Ukrainian";

export type CallRecipientValidationCode =
  "UNSUPPORTED_RECIPIENT_REGION" | "UNSUPPORTED_RECIPIENT_LANGUAGE";

export class CallRecipientValidationError extends Error {
  constructor(readonly code: CallRecipientValidationCode) {
    super("Unsupported call recipient");
    this.name = "CallRecipientValidationError";
  }
}

const RECIPIENT_PROFILES = {
  "en-US": {
    region: "US",
    locale: "en-US",
    country: "United States",
    language: "English",
    phonePattern: US_E164_PATTERN,
    mask: (phoneE164: string) => `+1 ***-***-${phoneE164.slice(-4)}`,
  },
  "en-KE": {
    region: "KE",
    locale: "en-KE",
    country: "Kenya",
    language: "English",
    phonePattern: KE_E164_PATTERN,
    mask: (phoneE164: string) => `+254 ***-**-${phoneE164.slice(-4)}`,
  },
  "en-UA": {
    region: "UA",
    locale: "en-UA",
    country: "Ukraine",
    language: "English",
    phonePattern: UA_E164_PATTERN,
    mask: (phoneE164: string) => `+380 **-***-${phoneE164.slice(-4)}`,
  },
  "uk-UA": {
    region: "UA",
    locale: "uk-UA",
    country: "Ukraine",
    language: "Ukrainian",
    phonePattern: UA_E164_PATTERN,
    mask: (phoneE164: string) => `+380 **-***-${phoneE164.slice(-4)}`,
  },
} as const;

type RecipientLocale = keyof typeof RECIPIENT_PROFILES;
type RecipientProfile = (typeof RECIPIENT_PROFILES)[RecipientLocale];

function resolveRecipientProfile(phoneE164: string): RecipientProfile {
  const profile = Object.values(RECIPIENT_PROFILES).find(({ phonePattern }) =>
    phonePattern.test(phoneE164),
  );
  if (profile === undefined) {
    throw new CallRecipientValidationError("UNSUPPORTED_RECIPIENT_REGION");
  }
  return profile;
}

export function maskPhoneNumber(phoneE164: string): string {
  return resolveRecipientProfile(phoneE164).mask(phoneE164);
}

const usCallRecipientObjectSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(US_E164_PATTERN),
    maskedPhone: z.string().regex(US_MASKED_PHONE_PATTERN),
    region: z.literal("US"),
    locale: z.literal("en-US"),
  })
  .refine(
    (recipient) =>
      recipient.maskedPhone ===
      RECIPIENT_PROFILES["en-US"].mask(recipient.phoneE164),
    {
      message: "Masked phone must match the phone number",
      path: ["maskedPhone"],
    },
  );

const kenyaCallRecipientObjectSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(KE_E164_PATTERN),
    maskedPhone: z.string().regex(KE_MASKED_PHONE_PATTERN),
    region: z.literal("KE"),
    locale: z.literal("en-KE"),
  })
  .refine(
    (recipient) =>
      recipient.maskedPhone ===
      RECIPIENT_PROFILES["en-KE"].mask(recipient.phoneE164),
    {
      message: "Masked phone must match the phone number",
      path: ["maskedPhone"],
    },
  );

const ukraineEnglishCallRecipientObjectSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(UA_E164_PATTERN),
    maskedPhone: z.string().regex(UA_MASKED_PHONE_PATTERN),
    region: z.literal("UA"),
    locale: z.literal("en-UA"),
  })
  .refine(
    (recipient) =>
      recipient.maskedPhone ===
      RECIPIENT_PROFILES["en-UA"].mask(recipient.phoneE164),
    {
      message: "Masked phone must match the phone number",
      path: ["maskedPhone"],
    },
  );

const ukraineUkrainianCallRecipientObjectSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(UA_E164_PATTERN),
    maskedPhone: z.string().regex(UA_MASKED_PHONE_PATTERN),
    region: z.literal("UA"),
    locale: z.literal("uk-UA"),
  })
  .refine(
    (recipient) =>
      recipient.maskedPhone ===
      RECIPIENT_PROFILES["uk-UA"].mask(recipient.phoneE164),
    {
      message: "Masked phone must match the phone number",
      path: ["maskedPhone"],
    },
  );

export const callRecipientSchema = withPlainDataBoundary(
  z.union([
    usCallRecipientObjectSchema,
    kenyaCallRecipientObjectSchema,
    ukraineEnglishCallRecipientObjectSchema,
    ukraineUkrainianCallRecipientObjectSchema,
  ]),
);

const callRecipientInputSchema = withPlainDataBoundary(
  z.strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string(),
    language: z.string().max(32).optional(),
    region: z.enum(["US", "KE", "UA"]).optional(),
    locale: z.enum(["en-US", "en-KE", "en-UA", "uk-UA"]).optional(),
  }),
);

export type CallRecipient = z.infer<typeof callRecipientSchema>;

export function createCallRecipient(input: unknown): CallRecipient {
  const parsed = callRecipientInputSchema.parse(input);
  const countryProfile = resolveRecipientProfile(parsed.phoneE164);

  if (parsed.region !== undefined && parsed.region !== countryProfile.region) {
    throw new CallRecipientValidationError("UNSUPPORTED_RECIPIENT_REGION");
  }

  let locale: RecipientLocale;
  if (countryProfile.region === "UA") {
    if (parsed.language === "English") {
      locale = "en-UA";
    } else if (parsed.language === "Ukrainian") {
      locale = "uk-UA";
    } else {
      throw new CallRecipientValidationError("UNSUPPORTED_RECIPIENT_LANGUAGE");
    }
  } else {
    if (parsed.language !== undefined) {
      throw new CallRecipientValidationError("UNSUPPORTED_RECIPIENT_LANGUAGE");
    }
    locale = countryProfile.locale;
  }

  if (parsed.locale !== undefined && parsed.locale !== locale) {
    throw new CallRecipientValidationError("UNSUPPORTED_RECIPIENT_LANGUAGE");
  }

  const profile = RECIPIENT_PROFILES[locale];
  return callRecipientSchema.parse({
    recipientName: parsed.recipientName,
    phoneE164: parsed.phoneE164,
    maskedPhone: profile.mask(parsed.phoneE164),
    region: profile.region,
    locale: profile.locale,
  });
}

export function getCallRecipientPresentation(input: unknown): {
  readonly country: "United States" | "Kenya" | "Ukraine";
  readonly language: RecipientLanguage;
} {
  const recipient = callRecipientSchema.parse(input);
  const profile = RECIPIENT_PROFILES[recipient.locale];
  return { country: profile.country, language: profile.language };
}
