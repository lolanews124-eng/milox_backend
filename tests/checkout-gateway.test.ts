import { describe, expect, it } from "vitest";

import {
  isIndiaCountry,
  resolveCheckoutCurrency,
} from "../src/modules/payments/application/checkout-gateway.js";

describe("checkout currency by country", () => {
  it("shows INR + Razorpay for India profiles", () => {
    expect(resolveCheckoutCurrency("India")).toEqual({
      gateway: "RAZORPAY",
      country: "India",
      currency: "INR",
      label: "Razorpay",
    });
    expect(isIndiaCountry("IN")).toBe(true);
    expect(resolveCheckoutCurrency("in").currency).toBe("INR");
  });

  it("shows USD + PayPal for every other country", () => {
    expect(resolveCheckoutCurrency("United States")).toEqual({
      gateway: "PAYPAL",
      country: "United States",
      currency: "USD",
      label: "PayPal",
    });
  });

  it("defaults blank country to INR Razorpay (India-first)", () => {
    expect(resolveCheckoutCurrency(null).currency).toBe("INR");
    expect(resolveCheckoutCurrency("").gateway).toBe("RAZORPAY");
    expect(isIndiaCountry(null)).toBe(true);
  });
});
