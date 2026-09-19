import { describe, expect, it } from "vitest";

import {
  isIndiaCountry,
  resolveCheckoutCurrency,
} from "../src/modules/payments/application/checkout-gateway.js";

describe("checkout currency by country", () => {
  it("shows INR for India profiles", () => {
    expect(resolveCheckoutCurrency("India")).toEqual({
      gateway: "RAZORPAY",
      country: "India",
      currency: "INR",
      label: "Razorpay",
    });
    expect(isIndiaCountry("IN")).toBe(true);
    expect(resolveCheckoutCurrency("in").currency).toBe("INR");
  });

  it("shows USD for every other country", () => {
    expect(resolveCheckoutCurrency("United States").currency).toBe("USD");
    expect(resolveCheckoutCurrency("United States").gateway).toBe("RAZORPAY");
  });

  it("defaults blank country to INR (India-first)", () => {
    expect(resolveCheckoutCurrency(null).currency).toBe("INR");
    expect(resolveCheckoutCurrency("").country).toBe("India");
    expect(isIndiaCountry(null)).toBe(true);
  });
});
