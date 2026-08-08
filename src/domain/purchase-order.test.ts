import { describe, expect, it } from "vitest";

import { purchaseOrderSchema } from "./purchase-order.js";

const validOrder = {
  supplierName: "Northstar Components",
  purchaseOrderRef: "PO-2026-001",
  expectedQuantity: 500,
  requiredDeliveryDate: "2026-08-20",
};

describe("purchaseOrderSchema", () => {
  it("accepts a bounded positive integer quantity and a valid date-only delivery date", () => {
    expect(purchaseOrderSchema.parse(validOrder)).toEqual(validOrder);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects an invalid expected quantity of %s",
    (expectedQuantity) => {
      expect(() =>
        purchaseOrderSchema.parse({ ...validOrder, expectedQuantity }),
      ).toThrow();
    },
  );

  it.each(["2026-02-29", "2026-13-01", "2026-08-20T00:00:00Z"])(
    "rejects an invalid date-only delivery date of %s",
    (requiredDeliveryDate) => {
      expect(() =>
        purchaseOrderSchema.parse({ ...validOrder, requiredDeliveryDate }),
      ).toThrow();
    },
  );

  it("trims bounded order text and rejects unknown or overlong fields", () => {
    expect(
      purchaseOrderSchema.parse({
        ...validOrder,
        supplierName: "  Northstar Components  ",
        purchaseOrderRef: "  PO-2026-001  ",
      }),
    ).toMatchObject({
      supplierName: "Northstar Components",
      purchaseOrderRef: "PO-2026-001",
    });
    expect(() =>
      purchaseOrderSchema.parse({
        ...validOrder,
        supplierName: "x".repeat(121),
      }),
    ).toThrow();
    expect(() =>
      purchaseOrderSchema.parse({ ...validOrder, extra: true }),
    ).toThrow();
  });
});
