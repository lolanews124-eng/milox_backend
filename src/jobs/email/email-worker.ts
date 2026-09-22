import {
  EmailJobStatus,
  EmailJobType,
  Prisma,
  type EmailJob,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import { markMarketingRecipientResult } from "../../modules/email-marketing/email-campaign-service.js";
import {
  resolveEmailRuntime,
  type EmailRuntimeConfig,
} from "./email-settings.js";
import { sendViaZeptoMail } from "./zeptomail-client.js";

const verificationPayloadSchema = z.object({
  userId: z.string().uuid(),
  token: z.string().min(32),
});

const passwordResetPayloadSchema = z.object({
  userId: z.string().uuid(),
  otp: z.string().regex(/^\d{6}$/),
});

const marketingPayloadSchema = z.object({
  campaignId: z.string().uuid(),
  recipientId: z.string().uuid(),
  userId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
  text: z.string().min(1),
});

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const JOBS_PER_TICK = 8;

export class EmailWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private cachedRuntime: EmailRuntimeConfig | null = null;
  private cachedAt = 0;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  /** Call after admin saves email settings so the next tick picks up new keys. */
  invalidateCache(): void {
    this.cachedRuntime = null;
    this.cachedAt = 0;
  }

  get isConfigured(): boolean {
    // Worker always starts; each tick no-ops until admin configures ZeptoMail.
    return true;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.recoverStaleJobs();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.EMAIL_WORKER_POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const runtime = await this.getRuntime();
      if (!runtime.configured) return;

      for (let i = 0; i < JOBS_PER_TICK; i += 1) {
        const job = await this.claimNextJob();
        if (!job) break;

        try {
          const email = renderEmail(job, this.config.WEB_ORIGIN);
          await sendViaZeptoMail(
            {
              apiUrl: runtime.apiUrl,
              apiToken: runtime.apiToken,
              fromAddress: runtime.fromAddress,
              fromName: runtime.fromName,
              bounceAddress: runtime.bounceAddress,
            },
            {
              toEmail: job.toEmail,
              subject: email.subject,
              html: email.html,
              text: email.text,
            },
          );
          await this.database.emailJob.update({
            where: { id: job.id },
            data: {
              status: EmailJobStatus.SENT,
              sentAt: new Date(),
              lockedAt: null,
              lastError: null,
            },
          });
          await this.onMarketingOutcome(job, { ok: true });
        } catch (error: unknown) {
          await this.failOrRetry(job, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async getRuntime(): Promise<EmailRuntimeConfig> {
    const now = Date.now();
    if (this.cachedRuntime && now - this.cachedAt < 30_000) {
      return this.cachedRuntime;
    }
    this.cachedRuntime = await resolveEmailRuntime(
      this.database,
      this.config.JWT_ACCESS_SECRET,
    );
    this.cachedAt = now;
    return this.cachedRuntime;
  }

  private claimNextJob(): Promise<EmailJob | null> {
    return this.database.$transaction(
      async (transaction) => {
        const job = await transaction.emailJob.findFirst({
          where: {
            status: EmailJobStatus.PENDING,
            availableAt: { lte: new Date() },
          },
          orderBy: { createdAt: "asc" },
        });
        if (!job) return null;

        const claimed = await transaction.emailJob.updateMany({
          where: { id: job.id, status: EmailJobStatus.PENDING },
          data: {
            status: EmailJobStatus.PROCESSING,
            lockedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return null;

        return transaction.emailJob.findUnique({ where: { id: job.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async failOrRetry(job: EmailJob, error: unknown): Promise<void> {
    const attempts = job.attempts;
    const exhausted = attempts >= 5;
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error";
    await this.database.emailJob.update({
      where: { id: job.id },
      data: {
        status: exhausted ? EmailJobStatus.FAILED : EmailJobStatus.PENDING,
        availableAt: new Date(
          Date.now() + Math.min(2 ** attempts * 30_000, 3_600_000),
        ),
        lockedAt: null,
        lastError: message,
      },
    });
    if (exhausted) {
      await this.onMarketingOutcome(job, { ok: false, error: message });
    }
  }

  private async onMarketingOutcome(
    job: EmailJob,
    result: { ok: true } | { ok: false; error: string },
  ): Promise<void> {
    if (job.type !== EmailJobType.MARKETING) return;
    const parsed = marketingPayloadSchema.safeParse(job.payload);
    if (!parsed.success) return;
    await markMarketingRecipientResult(
      this.database,
      {
        campaignId: parsed.data.campaignId,
        recipientId: parsed.data.recipientId,
      },
      result,
    );
  }

  private async recoverStaleJobs(): Promise<void> {
    await this.database.emailJob.updateMany({
      where: {
        status: EmailJobStatus.PROCESSING,
        lockedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      data: {
        status: EmailJobStatus.PENDING,
        lockedAt: null,
        availableAt: new Date(),
      },
    });
  }
}

function renderEmail(job: EmailJob, webOrigin: string): RenderedEmail {
  if (job.type === EmailJobType.EMAIL_VERIFICATION) {
    const payload = verificationPayloadSchema.parse(job.payload);
    const url = tokenUrl(webOrigin, "/verify-email", payload.token);
    return {
      subject: "Verify your Milox email",
      text: `Verify your email: ${url}`,
      html: emailHtml(
        "Verify your email",
        "Complete your Milox registration using the secure link below.",
        "Verify email",
        url,
      ),
    };
  }

  if (job.type === EmailJobType.PASSWORD_RESET) {
    const payload = passwordResetPayloadSchema.parse(job.payload);
    return {
      subject: "Your Milox password reset code",
      text: `Your Milox password reset code is ${payload.otp}. It expires soon. If you did not request this, ignore this email.`,
      html: otpEmailHtml(payload.otp),
    };
  }

  if (job.type === EmailJobType.MARKETING) {
    const payload = marketingPayloadSchema.parse(job.payload);
    return {
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    };
  }

  throw new Error(`Unsupported email job type: ${job.type}`);
}

function tokenUrl(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function otpEmailHtml(otp: string): string {
  return `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#0b0b12;color:#f6f6f8;padding:32px">
<main style="max-width:560px;margin:auto;background:#171722;padding:32px;border-radius:16px">
<h1 style="margin:0 0 12px;font-size:22px">Reset your Milox password</h1>
<p style="margin:0 0 20px;line-height:1.5;color:#d4d4d8">Use this one-time code on the forgot-password page. Do not share it with anyone.</p>
<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#a1a1aa">Your code</p>
<p style="margin:0 0 24px;font-size:36px;font-weight:800;letter-spacing:0.28em;color:#fff">${escapeHtml(otp)}</p>
<p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.5">This code expires in a few minutes. If you did not request a password reset, you can ignore this email — your password will stay the same.</p>
<p style="margin:20px 0 0;color:#71717a;font-size:12px">Milox will never ask for your password by email.</p>
</main></body></html>`;
}

function emailHtml(
  heading: string,
  message: string,
  button: string,
  url: string,
): string {
  return `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#0b0b12;color:#f6f6f8;padding:32px">
<main style="max-width:560px;margin:auto;background:#171722;padding:32px;border-radius:16px">
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background:#7c3aed;color:white;text-decoration:none;border-radius:10px">${escapeHtml(button)}</a></p>
<p style="color:#a1a1aa;font-size:13px">Milox will never ask for your password by email.</p>
</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}
