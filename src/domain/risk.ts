import { z } from "zod";

import { purchaseOrderSchema, type PurchaseOrder } from "./purchase-order.js";
import {
  supplierResponseFactsSchema,
  type SupplierResponse,
} from "./supplier-response.js";

const AT_RISK_REASON_CODES = [
  "PARTIAL_AVAILABILITY",
  "LATE_PROMISE",
  "HUMAN_FOLLOW_UP",
] as const;

const atRiskReasonCodesSchema = z
  .array(z.enum(AT_RISK_REASON_CODES))
  .min(1)
  .superRefine((reasonCodes, context) => {
    const canonicalCodes = AT_RISK_REASON_CODES.filter((code) =>
      reasonCodes.includes(code),
    );

    if (
      reasonCodes.length !== canonicalCodes.length ||
      reasonCodes.some((code, index) => code !== canonicalCodes[index])
    ) {
      context.addIssue({
        code: "custom",
        message:
          "AT_RISK reason codes must be a canonical, deduplicated subset",
      });
    }
  })
  .readonly();

export const supplyRiskSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ON_TRACK"),
    reasonCodes: z.array(z.never()).length(0).readonly(),
  }),
  z.strictObject({
    status: z.literal("AT_RISK"),
    reasonCodes: atRiskReasonCodesSchema,
  }),
  z.strictObject({
    status: z.literal("BLOCKED"),
    reasonCodes: z.array(z.literal("UNABLE_TO_FULFILL")).length(1).readonly(),
  }),
  z.strictObject({
    status: z.literal("OUTCOME_UNKNOWN"),
    reasonCodes: z.array(z.literal("INSUFFICIENT_FACTS")).length(1).readonly(),
  }),
]);

export type SupplyRisk = z.infer<typeof supplyRiskSchema>;

export function assessSupplyRisk(
  order: PurchaseOrder,
  response: SupplierResponse,
): SupplyRisk {
  const parsedOrder = purchaseOrderSchema.parse(order);
  const parsedResponse = supplierResponseFactsSchema.parse(response);

  if (
    parsedResponse.contactOutcome !== "reached" ||
    parsedResponse.promisedDeliveryDate === "unknown" ||
    parsedResponse.followUpRequired === "unknown" ||
    parsedResponse.unableToFulfill === "unknown" ||
    parsedResponse.availableQuantity + parsedResponse.delayedQuantity !==
      parsedResponse.confirmedQuantity
  ) {
    return { status: "OUTCOME_UNKNOWN", reasonCodes: ["INSUFFICIENT_FACTS"] };
  }

  if (
    parsedResponse.unableToFulfill === "yes" ||
    parsedResponse.availableQuantity === 0
  ) {
    return { status: "BLOCKED", reasonCodes: ["UNABLE_TO_FULFILL"] };
  }

  const reasonCodes = [
    parsedResponse.availableQuantity < parsedOrder.expectedQuantity
      ? "PARTIAL_AVAILABILITY"
      : undefined,
    parsedResponse.promisedDeliveryDate > parsedOrder.requiredDeliveryDate
      ? "LATE_PROMISE"
      : undefined,
    parsedResponse.followUpRequired === "yes" ? "HUMAN_FOLLOW_UP" : undefined,
  ].filter(
    (code): code is (typeof AT_RISK_REASON_CODES)[number] => code !== undefined,
  );

  return reasonCodes.length > 0
    ? { status: "AT_RISK", reasonCodes }
    : { status: "ON_TRACK", reasonCodes: [] };
}
