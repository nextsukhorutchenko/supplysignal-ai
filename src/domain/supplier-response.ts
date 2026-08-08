import { z } from "zod";

const MAX_QUANTITY = 1_000_000;
const MAX_DELAY_REASON_LENGTH = 500;

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    month === 2
      ? isLeapYear
        ? 29
        : 28
      : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

const dateOnlySchema = z
  .string()
  .length(10)
  .refine(isValidDateOnly, "Expected a valid ISO date-only value");

export const supplierResponseFactsSchema = z.strictObject({
  contactOutcome: z.enum(["reached", "declined", "no_answer", "unknown"]),
  confirmedQuantity: z.number().int().nonnegative().max(MAX_QUANTITY),
  availableQuantity: z.number().int().nonnegative().max(MAX_QUANTITY),
  delayedQuantity: z.number().int().nonnegative().max(MAX_QUANTITY),
  promisedDeliveryDate: z.union([dateOnlySchema, z.literal("unknown")]),
  delayReason: z.string().trim().max(MAX_DELAY_REASON_LENGTH),
  followUpRequired: z.enum(["yes", "no", "unknown"]),
  unableToFulfill: z.enum(["yes", "no", "unknown"]),
});

export const supplierResponseSchema = supplierResponseFactsSchema.refine(
  (response) =>
    response.availableQuantity + response.delayedQuantity ===
    response.confirmedQuantity,
  {
    message:
      "Available and delayed quantities must equal the confirmed quantity",
    path: ["delayedQuantity"],
  },
);

export type SupplierResponse = z.infer<typeof supplierResponseSchema>;
