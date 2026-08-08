import { z } from "zod";

const MAX_QUANTITY = 1_000_000;
const MAX_SUPPLIER_NAME_LENGTH = 120;
const MAX_PURCHASE_ORDER_REF_LENGTH = 64;

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

export const purchaseOrderSchema = z.strictObject({
  supplierName: z.string().trim().min(1).max(MAX_SUPPLIER_NAME_LENGTH),
  purchaseOrderRef: z.string().trim().min(1).max(MAX_PURCHASE_ORDER_REF_LENGTH),
  expectedQuantity: z.number().int().positive().max(MAX_QUANTITY),
  requiredDeliveryDate: dateOnlySchema,
});

export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
