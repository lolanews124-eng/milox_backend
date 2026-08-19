import { describe, expect, it } from "vitest";

import {
  parsePaypalPaidCapture,
  paypalPaymentMatchesCheckout,
} from "../src/modules/payments/application/paypal-capture.js";

describe("PayPal capture gating", () => {
  const checkout = { amountMinor: 200, currency: "USD" };

  it("does not treat an approved-but-uncaptured order as paid", () => {
    const paid = parsePaypalPaidCapture({ status: "APPROVED" });
    expect(paid.paid).toBe(false);
    expect(paypalPaymentMatchesCheckout(paid, checkout)).toBe(false);
  });

  it("does not fulfill a pending capture", () => {
    const paid = parsePaypalPaidCapture({
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: "CAP-PENDING",
                status: "PENDING",
                amount: { currency_code: "USD", value: "2.00" },
              },
            ],
          },
        },
      ],
    });
    expect(paid.paid).toBe(false);
    expect(paypalPaymentMatchesCheckout(paid, checkout)).toBe(false);
  });

  it("does not fulfill when the captured amount differs", () => {
    const paid = parsePaypalPaidCapture({
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: "CAP-DONE",
                status: "COMPLETED",
                amount: { currency_code: "USD", value: "0.01" },
              },
            ],
          },
        },
      ],
    });
    expect(paid.paid).toBe(true);
    expect(paypalPaymentMatchesCheckout(paid, checkout)).toBe(false);
  });

  it("fulfills only a completed capture at the exact checkout amount", () => {
    const paid = parsePaypalPaidCapture({
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: "CAP-DONE",
                status: "COMPLETED",
                amount: { currency_code: "USD", value: "2.00" },
              },
            ],
          },
        },
      ],
    });
    expect(paid.paid).toBe(true);
    expect(paid.captureId).toBe("CAP-DONE");
    expect(paid.amountMinor).toBe(200);
    expect(paypalPaymentMatchesCheckout(paid, checkout)).toBe(true);
  });
});
