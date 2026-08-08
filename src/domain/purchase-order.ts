import { z } from "zod";

const MAX_QUANTITY = 1_000_000;
const MAX_SUPPLIER_NAME_LENGTH = 120;
const MAX_PURCHASE_ORDER_REF_LENGTH = 64;

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    year >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
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
