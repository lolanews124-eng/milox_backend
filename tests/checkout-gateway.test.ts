import { describe, expect, it } from "vitest";

import {
  INDIA_GATEWAY_UNAVAILABLE_MESSAGE,
  isIndiaCountry,
  resolveCheckoutGateway,
} from "../src/modules/payments/application/checkout-gateway.js";

describe("checkout gateway routing", () => {
  it("sends India profiles to Cashfree INR", () => {
    expect(resolveCheckoutGateway("India")).toEqual({
      gateway: "CASHFREE",
      country: "India",
      currency: "INR",
      label: "Cashfree (UPI / Cards / Netbanking)",
    });
    expect(isIndiaCountry("IN")).toBe(true);
    expect(resolveCheckoutGateway("in").gateway).toBe("CASHFREE");
  });

  it("sends every other country to PayPal USD", () => {
    expect(resolveCheckoutGateway("United States").gateway).toBe("PAYPAL");
    expect(resolveCheckoutGateway("United States").currency).toBe("USD");
    expect(resolveCheckoutGateway(null).gateway).toBe("PAYPAL");
  });

  it("keeps the India unavailable copy stable", () => {
    expect(INDIA_GATEWAY_UNAVAILABLE_MESSAGE).toMatch(/coming soon/i);
  });
});
