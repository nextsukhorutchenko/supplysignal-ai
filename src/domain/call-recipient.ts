import { z } from "zod";

import { withPlainDataBoundary } from "./plain-data.js";

const US_E164_PATTERN = /^\+1[2-9]\d{9}$/;
const MASKED_PHONE_PATTERN = /^\+1 \*\*\*-\*\*\*-\d{4}$/;

export function maskPhoneNumber(phoneE164: string): string {
  return `+1 ***-***-${phoneE164.slice(-4)}`;
}

const callRecipientObjectSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(US_E164_PATTERN),
    maskedPhone: z.string().regex(MASKED_PHONE_PATTERN),
    region: z.literal("US"),
    locale: z.literal("en-US"),
  })
  .refine(
    (recipient) =>
      recipient.maskedPhone === maskPhoneNumber(recipient.phoneE164),
    {
      message: "Masked phone must match the phone number",
      path: ["maskedPhone"],
    },
  );

export const callRecipientSchema = withPlainDataBoundary(
  callRecipientObjectSchema,
);

const callRecipientInputSchema = withPlainDataBoundary(
  z.strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(US_E164_PATTERN),
    region: z.literal("US"),
    locale: z.literal("en-US"),
  }),
);

export type CallRecipient = z.infer<typeof callRecipientSchema>;

export function createCallRecipient(input: unknown): CallRecipient {
  const parsed = callRecipientInputSchema.parse(input);

  return callRecipientSchema.parse({
    ...parsed,
    maskedPhone: maskPhoneNumber(parsed.phoneE164),
  });
}
