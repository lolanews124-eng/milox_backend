/** India → Cashfree; every other profile country → PayPal. */
export type CheckoutGateway = "CASHFREE" | "PAYPAL";

export function resolveCheckoutGateway(country: string | null | undefined): {
  gateway: CheckoutGateway;
  country: string;
  currency: string;
  label: string;
} {
  const normalized = (country ?? "").trim() || "Unknown";
  if (normalized.toLowerCase() === "india") {
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
