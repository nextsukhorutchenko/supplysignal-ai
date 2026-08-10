import { z } from "zod";

import { withPlainDataBoundary } from "./plain-data.js";

const US_E164_PATTERN = /^\+1[2-9]\d{9}$/;
const KE_E164_PATTERN = /^\+254[1-9]\d{8}$/;
const US_MASKED_PHONE_PATTERN = /^\+1 \*\*\*-\*\*\*-\d{4}$/;
const KE_MASKED_PHONE_PATTERN = /^\+254 \*\*\*-\*\*-\d{4}$/;

const RECIPIENT_PROFILES = {
  US: {
    region: "US",
    locale: "en-US",
    country: "United States",
    language: "English",
    phonePattern: US_E164_PATTERN,
    mask: (phoneE164: string) => `+1 ***-***-${phoneE164.slice(-4)}`,
  },
  KE: {
    region: "KE",
    locale: "en-KE",
    country: "Kenya",
    language: "English",
    phonePattern: KE_E164_PATTERN,
    mask: (phoneE164: string) => `+254 ***-**-${phoneE164.slice(-4)}`,
  },
} as const;

function resolveRecipientProfile(phoneE164: string) {
  const profile = Object.values(RECIPIENT_PROFILES).find(({ phonePattern }) =>
    phonePattern.test(phoneE164),
  );
  if (profile === undefined) {
    throw new Error("Unsupported recipient profile");
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
      US_E164_PATTERN.test(recipient.phoneE164) &&
      recipient.maskedPhone === maskPhoneNumber(recipient.phoneE164),
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
      KE_E164_PATTERN.test(recipient.phoneE164) &&
      recipient.maskedPhone === maskPhoneNumber(recipient.phoneE164),
    {
      message: "Masked phone must match the phone number",
      path: ["maskedPhone"],
    },
  );

export const callRecipientSchema = withPlainDataBoundary(
  z.union([usCallRecipientObjectSchema, kenyaCallRecipientObjectSchema]),
);

const callRecipientInputSchema = withPlainDataBoundary(
  z
    .strictObject({
      recipientName: z.string().trim().min(1).max(120),
      phoneE164: z.string(),
      region: z.enum(["US", "KE"]).optional(),
      locale: z.enum(["en-US", "en-KE"]).optional(),
    })
    .refine(
      (recipient) =>
        (recipient.region === undefined && recipient.locale === undefined) ||
        (recipient.region === "US" && recipient.locale === "en-US") ||
        (recipient.region === "KE" && recipient.locale === "en-KE"),
      {
        message: "Region and locale must be a supported pair",
      },
    ),
);

export type CallRecipient = z.infer<typeof callRecipientSchema>;

export function createCallRecipient(input: unknown): CallRecipient {
  const parsed = callRecipientInputSchema.parse(input);
  const profile = resolveRecipientProfile(parsed.phoneE164);

  if (
    (parsed.region !== undefined && parsed.region !== profile.region) ||
    (parsed.locale !== undefined && parsed.locale !== profile.locale)
  ) {
    throw new Error("Recipient profile does not match the phone number");
  }

  return callRecipientSchema.parse({
    recipientName: parsed.recipientName,
    phoneE164: parsed.phoneE164,
    maskedPhone: profile.mask(parsed.phoneE164),
    region: profile.region,
    locale: profile.locale,
  });
}

export function getCallRecipientPresentation(input: unknown): {
  readonly country: "United States" | "Kenya";
  readonly language: "English";
} {
  const recipient = callRecipientSchema.parse(input);
  const profile = RECIPIENT_PROFILES[recipient.region];
  return { country: profile.country, language: profile.language };
}
