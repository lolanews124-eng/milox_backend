import { AppError } from "../../../shared/errors/app-error.js";
import type { CashfreeRuntimeConfig } from "../application/cashfree-settings.js";

type CredsLoader = () => Promise<CashfreeRuntimeConfig>;

export class CashfreeClient {
  private cached: CashfreeRuntimeConfig | null = null;

  constructor(private readonly loadCredentials: CredsLoader) {}

  invalidate(): void {
    this.cached = null;
  }

  private async creds(): Promise<CashfreeRuntimeConfig> {
    if (!this.cached) this.cached = await this.loadCredentials();
    return this.cached;
  }

  private baseUrl(mode: CashfreeRuntimeConfig["mode"]): string {
    return mode === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";
  }

  private checkoutBase(mode: CashfreeRuntimeConfig["mode"]): string {
    return mode === "production"
      ? "https://payments.cashfree.com/pg/view/sessions/checkout"
      : "https://sandbox.cashfree.com/pg/view/sessions/checkout";
  }

  async requireConfigured(): Promise<CashfreeRuntimeConfig> {
    const creds = await this.creds();
    if (!creds.appId || !creds.secretKey) {
      throw new AppError(
        "CASHFREE_NOT_CONFIGURED",
        "Cashfree is not configured. Add App ID and Secret in admin Payments.",
        503,
      );
    }
    return creds;
  }

  async testConnection(): Promise<{ ok: boolean; mode: string }> {
    const creds = await this.requireConfigured();
    // Lightweight authenticated call — list nothing / hit orders with invalid id returns 404 with auth ok.
    const response = await fetch(`${this.baseUrl(creds.mode)}/orders/milox-ping`, {
      method: "GET",
      headers: this.headers(creds),
    });
    // 401/403 = bad keys; 404 = keys accepted.
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "CASHFREE_AUTH_FAILED",
        "Cashfree rejected these App ID / Secret keys",
        400,
      );
    }
    return { ok: true, mode: creds.mode };
  }

  async createOrder(input: {
    orderId: string;
    amountMajor: number;
    currency: string;
    customerId: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    returnUrl: string;
    notifyUrl: string;
  }): Promise<{ orderId: string; paymentSessionId: string; paymentUrl: string }> {
    const creds = await this.requireConfigured();
    const phone =
      input.customerPhone?.replace(/\D/g, "").slice(-10) || "9999999999";
    const body = {
      order_id: input.orderId,
      order_amount: Number(input.amountMajor.toFixed(2)),
      order_currency: input.currency,
      customer_details: {
        customer_id: input.customerId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "milox",
        customer_phone: phone.length === 10 ? phone : "9999999999",
        ...(input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: input.notifyUrl,
      },
    };
    const response = await fetch(`${this.baseUrl(creds.mode)}/orders`, {
      method: "POST",
      headers: this.headers(creds),
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as {
      order_id?: string;
      payment_session_id?: string;
      message?: string;
      code?: string;
    };
    if (!response.ok || !json.payment_session_id) {
      throw new AppError(
        "CASHFREE_ORDER_FAILED",
        json.message || "Could not create Cashfree order",
        502,
      );
    }
    const sessionId = json.payment_session_id;
    return {
      orderId: json.order_id || input.orderId,
      paymentSessionId: sessionId,
      paymentUrl: `${this.checkoutBase(creds.mode)}?session_id=${encodeURIComponent(sessionId)}`,
    };
  }

  async getOrder(orderId: string): Promise<{
    orderStatus: string;
    orderAmount?: number;
    orderCurrency?: string;
    cfPaymentId?: string | null;
  }> {
    const creds = await this.requireConfigured();
    const response = await fetch(
      `${this.baseUrl(creds.mode)}/orders/${encodeURIComponent(orderId)}`,
      { method: "GET", headers: this.headers(creds) },
    );
    const json = (await response.json().catch(() => ({}))) as {
      order_status?: string;
      order_amount?: number;
      order_currency?: string;
      cf_payment_id?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new AppError(
        "CASHFREE_ORDER_LOOKUP_FAILED",
        json.message || "Could not fetch Cashfree order",
        502,
      );
    }
    return {
      orderStatus: (json.order_status || "").toUpperCase(),
      ...(json.order_amount !== undefined ? { orderAmount: json.order_amount } : {}),
      ...(json.order_currency !== undefined
        ? { orderCurrency: json.order_currency }
        : {}),
      cfPaymentId: json.cf_payment_id ?? null,
    };
  }

  private headers(creds: CashfreeRuntimeConfig): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-client-id": creds.appId,
      "x-client-secret": creds.secretKey,
      "x-api-version": "2023-08-01",
    };
  }
}
