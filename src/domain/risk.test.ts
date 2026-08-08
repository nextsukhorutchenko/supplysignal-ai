import { describe, expect, it } from "vitest";

import type { PurchaseOrder } from "./purchase-order.js";
import type { SupplierResponse } from "./supplier-response.js";
import { assessSupplyRisk } from "./risk.js";

const order500: PurchaseOrder = {
  supplierName: "Northstar Components",
  purchaseOrderRef: "PO-2026-001",
  expectedQuantity: 500,
  requiredDeliveryDate: "2026-08-20",
};

const response350Ready: SupplierResponse = {
  contactOutcome: "reached",
  confirmedQuantity: 500,
  availableQuantity: 350,
  delayedQuantity: 150,
  promisedDeliveryDate: "2026-08-25",
  delayReason: "Weather disruption",
  followUpRequired: "yes",
  unableToFulfill: "no",
};

describe("assessSupplyRisk", () => {
  it("returns insufficient facts before any other rule for a no-answer outcome", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        contactOutcome: "no_answer",
      }),
    ).toEqual({
      status: "OUTCOME_UNKNOWN",
      reasonCodes: ["INSUFFICIENT_FACTS"],
    });
  });

  it("returns insufficient facts before blocking for a declined outcome", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        contactOutcome: "declined",
        availableQuantity: 0,
        delayedQuantity: 500,
        unableToFulfill: "yes",
      }),
    ).toEqual({
      status: "OUTCOME_UNKNOWN",
      reasonCodes: ["INSUFFICIENT_FACTS"],
    });
  });

  it("returns insufficient facts when required facts are unknown", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        promisedDeliveryDate: "unknown",
      }),
    ).toEqual({
      status: "OUTCOME_UNKNOWN",
      reasonCodes: ["INSUFFICIENT_FACTS"],
    });
  });

  it.each([
    { followUpRequired: "unknown" },
    { unableToFulfill: "unknown" },
  ] as const)(
    "returns insufficient facts for an unknown required fact",
    (unknownFact) => {
      expect(
        assessSupplyRisk(order500, { ...response350Ready, ...unknownFact }),
      ).toEqual({
        status: "OUTCOME_UNKNOWN",
        reasonCodes: ["INSUFFICIENT_FACTS"],
      });
    },
  );

  it("returns insufficient facts for inconsistent response quantities", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        delayedQuantity: 149,
      } as SupplierResponse),
    ).toEqual({
      status: "OUTCOME_UNKNOWN",
      reasonCodes: ["INSUFFICIENT_FACTS"],
    });
  });

  it("blocks a reached response with zero available quantity", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        availableQuantity: 0,
        delayedQuantity: 500,
        unableToFulfill: "no",
      }),
    ).toEqual({ status: "BLOCKED", reasonCodes: ["UNABLE_TO_FULFILL"] });
  });

  it("blocks a reached response when the supplier cannot fulfill the order", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        unableToFulfill: "yes",
      }),
    ).toEqual({ status: "BLOCKED", reasonCodes: ["UNABLE_TO_FULFILL"] });
  });

  it("marks the approved demo scenario at risk in canonical reason-code order", () => {
    expect(assessSupplyRisk(order500, response350Ready)).toEqual({
      status: "AT_RISK",
      reasonCodes: ["PARTIAL_AVAILABILITY", "LATE_PROMISE", "HUMAN_FOLLOW_UP"],
    });
  });

  it("marks a complete on-time delivery without follow-up as on track", () => {
    expect(
      assessSupplyRisk(order500, {
        ...response350Ready,
        availableQuantity: 500,
        delayedQuantity: 0,
        promisedDeliveryDate: "2026-08-20",
        followUpRequired: "no",
      }),
    ).toEqual({ status: "ON_TRACK", reasonCodes: [] });
  });
});
