import { isIndiaCountry } from "./checkout-gateway.js";

export type MoneyCurrency = "INR" | "USD";

/** Default INR per 1 USD when economy config has no rate. */
export const DEFAULT_USD_INR_RATE = 85;

export function normalizeMoneyCurrency(
  value: string | null | undefined,
): MoneyCurrency {
  return (value ?? "").trim().toUpperCase() === "INR" ? "INR" : "USD";
}

export function chargeCurrencyForCountry(
  country: string | null | undefined,
): MoneyCurrency {
  return isIndiaCountry(country) ? "INR" : "USD";
}

/**
 * Convert minor units (paise/cents) between INR and USD using INR-per-USD rate.
 * Same currency → unchanged. Rounds to nearest minor unit (min 1 if input > 0).
 */
export function convertAmountMinor(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  usdInrRate: number,
): number {
  const from = normalizeMoneyCurrency(fromCurrency);
  const to = normalizeMoneyCurrency(toCurrency);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;
  if (from === to) return Math.round(amountMinor);

  const rate =
    Number.isFinite(usdInrRate) && usdInrRate > 0
      ? usdInrRate
      : DEFAULT_USD_INR_RATE;

  let converted: number;
  if (from === "USD" && to === "INR") {
    converted = amountMinor * rate;
  } else {
    // INR → USD
    converted = amountMinor / rate;
  }

  const rounded = Math.round(converted);
  return rounded > 0 ? rounded : 1;
}

export function presentMoneyForCountry(input: {
  amountMinor: number;
  currency: string;
  country: string | null | undefined;
  usdInrRate: number;
}): { amountMinor: number; currency: MoneyCurrency } {
  const currency = chargeCurrencyForCountry(input.country);
  return {
    amountMinor: convertAmountMinor(
      input.amountMinor,
      input.currency,
      currency,
      input.usdInrRate,
    ),
    currency,
  };
}
