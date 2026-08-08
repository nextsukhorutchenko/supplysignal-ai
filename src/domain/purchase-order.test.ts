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

  it("accepts the maximum supported quantity and rejects quantities above it", () => {
    expect(
      purchaseOrderSchema.parse({ ...validOrder, expectedQuantity: 1_000_000 }),
    ).toMatchObject({ expectedQuantity: 1_000_000 });
    expect(() =>
      purchaseOrderSchema.parse({ ...validOrder, expectedQuantity: 1_000_001 }),
    ).toThrow();
  });

  it.each([Number.NEGATIVE_INFINITY, Number.NaN])(
    "rejects a non-finite expected quantity of %s",
    (expectedQuantity) => {
      expect(() =>
        purchaseOrderSchema.parse({ ...validOrder, expectedQuantity }),
      ).toThrow();
    },
  );

  it.each(["0004-02-29", "0099-12-31", "2000-02-29"])(
    "accepts a valid proleptic-Gregorian date-only value of %s",
    (requiredDeliveryDate) => {
      expect(
        purchaseOrderSchema.parse({ ...validOrder, requiredDeliveryDate }),
      ).toMatchObject({ requiredDeliveryDate });
    },
  );

  it.each([
    "0001-02-29",
    "1900-02-29",
    "2026-02-29",
    "2026-13-01",
    "2026-08-20T00:00:00Z",
  ])(
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
