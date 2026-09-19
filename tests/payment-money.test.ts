import { describe, expect, it } from "vitest";

import { convertAmountMinor } from "../src/modules/payments/application/payment-money.js";

describe("payment money conversion", () => {
  it("keeps same currency unchanged", () => {
    expect(convertAmountMinor(49900, "INR", "INR", 85)).toBe(49900);
    expect(convertAmountMinor(499, "USD", "USD", 85)).toBe(499);
  });

  it("converts INR base to USD for international", () => {
    // ₹499.00 → $5.87 at 85
    expect(convertAmountMinor(49900, "INR", "USD", 85)).toBe(587);
  });

  it("converts USD base to INR for India", () => {
    // $4.99 → ₹424.15 at 85
    expect(convertAmountMinor(499, "USD", "INR", 85)).toBe(42415);
  });
});
