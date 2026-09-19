import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import { AppError } from "../../../shared/errors/app-error.js";
import type { RazorpayRuntimeConfig } from "../application/razorpay-settings.js";

type Json = Record<string, unknown>;

function equalHex(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().toLowerCase());
  const right = Buffer.from(b.trim().toLowerCase());
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export class RazorpayClient {
  private cached: RazorpayRuntimeConfig | null = null;

  constructor(
    private readonly resolveCredentials: () => Promise<RazorpayRuntimeConfig>,
  ) {}

  invalidate() {
    this.cached = null;
  }

  async runtime(): Promise<RazorpayRuntimeConfig> {
    if (!this.cached) {
      this.cached = await this.resolveCredentials();
    }
    return this.cached;
  }

  async isConfigured(): Promise<boolean> {
    const runtime = await this.runtime();
    return Boolean(runtime.keyId && runtime.keySecret);
  }

  async requireConfigured(): Promise<RazorpayRuntimeConfig> {
    const runtime = await this.runtime();
    if (!runtime.keyId || !runtime.keySecret) {
      throw new AppError(
        "RAZORPAY_NOT_CONFIGURED",
        "Razorpay is not configured. Ask admin to add Key ID and Secret in Payments.",
        503,
      );
    }
    return runtime;
  }

  async verifyCredentials(): Promise<{ ok: boolean; mode: string }> {
    const runtime = await this.requireConfigured();
    await this.request("GET", "/orders?count=1", undefined, runtime);
    return { ok: true, mode: runtime.mode };
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{ id: string; amount: number; currency: string }> {
    const runtime = await this.requireConfigured();
    return this.request(
      "POST",
      "/orders",
      {
        amount: input.amountMinor,
        currency: input.currency.toUpperCase(),
        receipt: input.receipt.slice(0, 40),
        notes: input.notes ?? {},
        payment_capture: 1,
      },
      runtime,
    );
  }

  async fetchPayment(paymentId: string): Promise<{
    id: string;
    order_id: string;
    status: string;
    amount: number;
    currency: string;
  }> {
    const runtime = await this.requireConfigured();
    return this.request(
      "GET",
      `/payments/${encodeURIComponent(paymentId)}`,
      undefined,
      runtime,
    );
  }

  verifyPaymentSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
    keySecret: string;
  }): boolean {
    const expected = createHmac("sha256", input.keySecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest("hex");
    return equalHex(expected, input.signature);
  }

  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    webhookSecret: string,
  ): boolean {
    if (!webhookSecret.trim() || !signature.trim()) return false;
    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    return equalHex(expected, signature);
  }

  private async request<T = Json>(
    method: "GET" | "POST",
    path: string,
    body: Json | undefined,
    runtime: RazorpayRuntimeConfig,
  ): Promise<T> {
    const auth = Buffer.from(`${runtime.keyId}:${runtime.keySecret}`).toString(
      "base64",
    );
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`https://api.razorpay.com/v1${path}`, init);
    const text = await response.text();
    let json: Json = {};
    try {
      json = text ? (JSON.parse(text) as Json) : {};
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      const description =
        typeof json.error === "object" &&
        json.error &&
        "description" in json.error
          ? String((json.error as { description?: string }).description)
          : text.slice(0, 200);
      throw new AppError(
        "RAZORPAY_API_ERROR",
        `Razorpay error: ${description || response.statusText}`,
        502,
      );
    }
    return json as T;
  }
}
