export type PaypalPaidCapture = {
  paid: boolean;
  orderStatus: string;
  captureStatus: string | null;
  captureId: string | null;
  amountMinor: number | null;
  currency: string | null;
};

type PaypalOrderPayload = {
  status?: string;
  purchase_units?: Array<{
    amount?: { currency_code?: string; value?: string };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      }>;
    };
  }>;
};

function asOrderPayload(payload: unknown): PaypalOrderPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as PaypalOrderPayload;
}

export function parsePaypalPaidCapture(payload: unknown): PaypalPaidCapture {
  const order = asOrderPayload(payload);
  const captures = order.purchase_units?.[0]?.payments?.captures ?? [];
  const completed =
    captures.find((item) => item.status === "COMPLETED" && item.id) ?? null;
  const amount = completed?.amount ?? order.purchase_units?.[0]?.amount;
  const amountMinor =
    amount?.value != null && Number.isFinite(Number(amount.value))
      ? Math.round(Number(amount.value) * 100)
      : null;
  return {
    paid: Boolean(completed?.id),
    orderStatus: order.status ?? "UNKNOWN",
    captureStatus: completed?.status ?? captures[0]?.status ?? null,
    captureId: completed?.id ?? null,
    amountMinor,
    currency: amount?.currency_code?.toUpperCase() ?? null,
  };
}

export function paypalPaymentMatchesCheckout(
  paid: PaypalPaidCapture,
  checkout: { amountMinor: number; currency: string },
): boolean {
  if (!paid.paid || !paid.captureId) return false;
  if (paid.amountMinor !== checkout.amountMinor) return false;
  if (!paid.currency || paid.currency !== checkout.currency.toUpperCase()) return false;
  return true;
}
