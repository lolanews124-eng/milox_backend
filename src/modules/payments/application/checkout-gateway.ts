/** India → Cashfree; every other profile country → PayPal. */
export type CheckoutGateway = "CASHFREE" | "PAYPAL";

export const INDIA_GATEWAY_UNAVAILABLE_MESSAGE =
  "Coming soon. Payment gateway is not set up for Indian users yet.";

export function isIndiaCountry(country: string | null | undefined): boolean {
  const normalized = (country ?? "").trim().toLowerCase();
  return normalized === "india" || normalized === "in";
}

export function resolveCheckoutGateway(country: string | null | undefined): {
  gateway: CheckoutGateway;
  country: string;
  currency: string;
  label: string;
} {
  const normalized = (country ?? "").trim() || "Unknown";
  if (isIndiaCountry(normalized)) {
    return {
      gateway: "CASHFREE",
      country: "India",
      currency: "INR",
      label: "Cashfree (UPI / Cards / Netbanking)",
    };
  }
  return {
    gateway: "PAYPAL",
    country: normalized === "Unknown" ? "International" : normalized,
    currency: "USD",
    label: "PayPal",
  };
}
