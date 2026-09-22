/**
 * India → Razorpay (INR).
 * Every other set profile country → PayPal (USD).
 * Blank/unset country defaults to India (India-first).
 */

export function isIndiaCountry(country: string | null | undefined): boolean {
  const normalized = (country ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "india" || normalized === "in";
}

export type CheckoutGateway = "RAZORPAY" | "PAYPAL";

export type CheckoutCurrencyResolution = {
  gateway: CheckoutGateway;
  country: string;
  currency: "INR" | "USD";
  label: string;
};

export function resolveCheckoutCurrency(
  country: string | null | undefined,
): CheckoutCurrencyResolution {
  const raw = (country ?? "").trim();
  if (!raw || isIndiaCountry(raw)) {
    return {
      gateway: "RAZORPAY",
      country: "India",
      currency: "INR",
      label: "Razorpay",
    };
  }
  return {
    gateway: "PAYPAL",
    country: raw,
    currency: "USD",
    label: "PayPal",
  };
}

/** @deprecated Use resolveCheckoutCurrency — kept for older imports/tests. */
export const resolveCheckoutGateway = resolveCheckoutCurrency;

export const INDIA_GATEWAY_UNAVAILABLE_MESSAGE =
  "Razorpay is not configured yet. Ask admin to add Key ID and Secret in Payments.";

export const PAYPAL_GATEWAY_UNAVAILABLE_MESSAGE =
  "PayPal is not configured yet. Ask admin to add Client ID and Secret in Payments.";
