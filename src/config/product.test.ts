import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "./product";

describe("product metadata", () => {
  it("uses the approved SupplySignal identity", () => {
    expect(PRODUCT_NAME).toBe("SupplySignal AI");
    expect(PRODUCT_TAGLINE).toBe(
      "Call suppliers. Verify delivery risk. Keep the evidence.",
    );
  });
});
