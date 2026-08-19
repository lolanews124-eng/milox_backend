import { AppError } from "../../../shared/errors/app-error.js";
import {
  parsePaypalPaidCapture,
  type PaypalPaidCapture,
} from "../application/paypal-capture.js";
import type { PaypalRuntimeConfig } from "../application/paypal-settings.js";

interface PaypalToken {
  value: string;
  expiresAt: number;
}

export class PaypalClient {
  private token: PaypalToken | null = null;
  private lastCredKey = "";

  constructor(private readonly load: () => Promise<PaypalRuntimeConfig>) {}

  invalidate(): void {
    this.token = null;
    this.lastCredKey = "";
  }

  async runtime(): Promise<PaypalRuntimeConfig> {
    const runtime = await this.load();
    const key = `${runtime.mode}:${runtime.clientId}:${runtime.clientSecret}`;
    if (key !== this.lastCredKey) {
      this.token = null;
      this.lastCredKey = key;
    }
    return runtime;
  }

  async isConfigured(): Promise<boolean> {
    const runtime = await this.runtime();
    return Boolean(runtime.clientId && runtime.clientSecret);
  }

  async requireConfigured(): Promise<void> {
    if (!(await this.isConfigured())) {
      throw new AppError(
        "PAYPAL_NOT_CONFIGURED",
        "PayPal checkout is not configured yet",
        503,
      );
    }
  }

  async verifyCredentials(): Promise<{ ok: true; mode: "sandbox" | "live" }> {
    await this.accessToken();
    const runtime = await this.runtime();
    return { ok: true, mode: runtime.mode };
  }

  private apiBase(mode: "sandbox" | "live"): string {
    return mode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    description: string;
    customId: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; approvalUrl: string }> {
    await this.requireConfigured();
    const value = (input.amountMinor / 100).toFixed(2);
    const payload = await this.requestOk<{
      id?: string;
      links?: Array<{ rel?: string; href?: string }>;
    }>("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: input.customId,
            description: input.description.slice(0, 127),
            amount: {
              currency_code: input.currency.toUpperCase(),
              value,
            },
          },
        ],
        application_context: {
          brand_name: "Milox",
          landing_page: "NO_PREFERENCE",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      }),
    });
    const approvalUrl = payload.links?.find((link) => link.rel === "approve")?.href;
    if (!payload.id || !approvalUrl) {
      throw new AppError("PAYPAL_ERROR", "PayPal did not return a checkout URL", 502);
    }
    return { id: payload.id, approvalUrl };
  }

  async capturePaidOrder(orderId: string): Promise<PaypalPaidCapture> {
    await this.requireConfigured();
    const captured = await this.requestJson(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST" },
    );
    if (captured.ok) {
      const fromCapture = parsePaypalPaidCapture(captured.body);
      if (fromCapture.paid) return fromCapture;
    } else if (
      captured.issue === "ORDER_NOT_APPROVED" ||
      captured.issue === "PAYER_ACTION_REQUIRED"
    ) {
      throw new AppError(
        "PAYPAL_NOT_COMPLETED",
        "PayPal payment is not completed yet",
        409,
      );
    } else if (captured.issue && captured.issue !== "ORDER_ALREADY_CAPTURED") {
      throw new AppError(
        "PAYPAL_ERROR",
        captured.message ?? "PayPal request failed",
        502,
      );
    }
    return this.inspectOrder(orderId);
  }

  async inspectOrder(orderId: string): Promise<PaypalPaidCapture> {
    const payload = await this.requestOk(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      { method: "GET" },
    );
    return parsePaypalPaidCapture(payload);
  }

  async verifyWebhook(
    headers: {
      authAlgo: string;
      certUrl: string;
      transmissionId: string;
      transmissionSig: string;
      transmissionTime: string;
    },
    rawBody: string,
  ): Promise<boolean> {
    const runtime = await this.runtime();
    if (!runtime.webhookId) {
      return runtime.nodeEnv !== "production";
    }
    await this.requireConfigured();
    const payload = await this.requestOk<{ verification_status?: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: JSON.stringify({
          auth_algo: headers.authAlgo,
          cert_url: headers.certUrl,
          transmission_id: headers.transmissionId,
          transmission_sig: headers.transmissionSig,
          transmission_time: headers.transmissionTime,
          webhook_id: runtime.webhookId,
          webhook_event: JSON.parse(rawBody) as unknown,
        }),
      },
    );
    return payload.verification_status === "SUCCESS";
  }

  private async accessToken(): Promise<string> {
    await this.requireConfigured();
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    const runtime = await this.runtime();
    const basic = Buffer.from(`${runtime.clientId}:${runtime.clientSecret}`).toString(
      "base64",
    );
    const response = await fetch(`${this.apiBase(runtime.mode)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !json.access_token) {
      throw new AppError(
        "PAYPAL_ERROR",
        json.error_description ?? "Could not authenticate with PayPal",
        502,
      );
    }
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 300) * 1000,
    };
    return this.token.value;
  }

  private async requestOk<T>(path: string, init: RequestInit): Promise<T> {
    const result = await this.requestJson<T>(path, init);
    if (!result.ok) {
      throw new AppError(
        "PAYPAL_ERROR",
        result.message ?? "PayPal request failed",
        502,
      );
    }
    return result.body;
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<{
    ok: boolean;
    issue: string | null;
    message?: string;
    body: T;
  }> {
    const runtime = await this.runtime();
    const token = await this.accessToken();
    const response = await fetch(`${this.apiBase(runtime.mode)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const json = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      details?: Array<{ issue?: string }>;
    };
    const issue = json.details?.find((item) => item.issue)?.issue ?? null;
    return {
      ok: response.ok,
      issue,
      ...(json.message ? { message: json.message } : {}),
      body: json,
    };
  }
}
