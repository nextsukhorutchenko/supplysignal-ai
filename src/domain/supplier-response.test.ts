import { describe, expect, it } from "vitest";

import { supplierResponseSchema } from "./supplier-response.js";

const validResponse = {
  contactOutcome: "reached",
  confirmedQuantity: 500,
  availableQuantity: 350,
  delayedQuantity: 150,
  promisedDeliveryDate: "2026-08-25",
  delayReason: "Weather disruption",
  followUpRequired: "yes",
  unableToFulfill: "no",
} as const;

describe("supplierResponseSchema", () => {
  it("accepts a normalized response with reconciled quantities", () => {
    expect(supplierResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it("rejects quantity totals that do not match the confirmed quantity", () => {
    expect(() =>
      supplierResponseSchema.parse({ ...validResponse, delayedQuantity: 149 }),
    ).toThrow();
  });

  it("allows zero available quantity when the response quantities reconcile", () => {
    expect(
      supplierResponseSchema.parse({
        ...validResponse,
        availableQuantity: 0,
        delayedQuantity: 500,
      }),
    ).toMatchObject({ availableQuantity: 0 });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid supplier quantities: %s",
    (availableQuantity) => {
      expect(() =>
        supplierResponseSchema.parse({ ...validResponse, availableQuantity }),
      ).toThrow();
    },
  );

  it("accepts unknown facts only through their explicit literals", () => {
    expect(
      supplierResponseSchema.parse({
        ...validResponse,
        promisedDeliveryDate: "unknown",
        followUpRequired: "unknown",
        unableToFulfill: "unknown",
      }),
    ).toMatchObject({ promisedDeliveryDate: "unknown" });
    expect(() =>
      supplierResponseSchema.parse({
        ...validResponse,
        promisedDeliveryDate: "2026-02-29",
      }),
    ).toThrow();
  });

  it("trims delay text and rejects overlong text or unknown keys", () => {
    expect(
      supplierResponseSchema.parse({
        ...validResponse,
        delayReason: "  Weather disruption  ",
      }),
    ).toMatchObject({ delayReason: "Weather disruption" });
    expect(() =>
      supplierResponseSchema.parse({
        ...validResponse,
        delayReason: "x".repeat(501),
      }),
    ).toThrow();
    expect(() =>
      supplierResponseSchema.parse({ ...validResponse, extra: true }),
    ).toThrow();
  });
});
