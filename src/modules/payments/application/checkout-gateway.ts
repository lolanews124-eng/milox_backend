/**
 * India → INR; every other set profile country → USD.
 * Blank/unset country defaults to INR (India-first; avoids charging $ by accident).
 * Gateway is always Razorpay.
 */

export function isIndiaCountry(country: string | null | undefined): boolean {
  const normalized = (country ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "india" || normalized === "in";
}

export type CheckoutCurrencyResolution = {
  gateway: "RAZORPAY";
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
    gateway: "RAZORPAY",
    country: raw,
    currency: "USD",
    label: "Razorpay",
  };
}

/** @deprecated Use resolveCheckoutCurrency — kept for older imports/tests. */
export const resolveCheckoutGateway = resolveCheckoutCurrency;

export const INDIA_GATEWAY_UNAVAILABLE_MESSAGE =
  "Coming soon. Payment gateway is not set up for Indian users yet.";
