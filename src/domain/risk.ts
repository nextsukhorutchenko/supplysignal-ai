import { z } from "zod";

import { purchaseOrderSchema, type PurchaseOrder } from "./purchase-order.js";
import {
  supplierResponseFactsSchema,
  type SupplierResponse,
} from "./supplier-response.js";

export const supplyRiskSchema = z.strictObject({
  status: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED", "OUTCOME_UNKNOWN"]),
  reasonCodes: z.array(z.string()).readonly(),
});

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
  ].filter((code): code is string => code !== undefined);

  return reasonCodes.length > 0
    ? { status: "AT_RISK", reasonCodes }
    : { status: "ON_TRACK", reasonCodes: [] };
}
