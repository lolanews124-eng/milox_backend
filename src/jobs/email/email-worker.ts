import {
  EmailJobStatus,
  EmailJobType,
  Prisma,
  type EmailJob,
  type PrismaClient,
} from "@prisma/client";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";

const tokenPayloadSchema = z.object({
  userId: z.string().uuid(),
  token: z.string().min(32),
});

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export class EmailWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly transporter: Transporter;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth:
        config.SMTP_USER && config.SMTP_PASSWORD
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASSWORD,
            }
          : undefined,
    });
  }

  get isConfigured(): boolean {
    return Boolean(this.config.SMTP_HOST);
  }

  async start(): Promise<void> {
    if (!this.isConfigured || this.timer) return;
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
      const job = await this.claimNextJob();
      if (!job) return;

      try {
        const email = renderEmail(job, this.config.WEB_ORIGIN);
        await this.transporter.sendMail({
          from: this.config.EMAIL_FROM,
          to: job.toEmail,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        await this.database.emailJob.update({
          where: { id: job.id },
          data: {
            status: EmailJobStatus.SENT,
            sentAt: new Date(),
            lockedAt: null,
            lastError: null,
          },
        });
      } catch (error: unknown) {
        await this.failOrRetry(job, error);
      }
    } finally {
      this.running = false;
    }
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
  const payload = tokenPayloadSchema.parse(job.payload);

  if (job.type === EmailJobType.EMAIL_VERIFICATION) {
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
    const url = tokenUrl(webOrigin, "/reset-password", payload.token);
    return {
      subject: "Reset your Milox password",
      text: `Reset your password: ${url}`,
      html: emailHtml(
        "Reset your password",
        "Use the secure link below. If you did not request this, ignore this email.",
        "Reset password",
        url,
      ),
    };
  }

  throw new Error(`Unsupported email job type: ${job.type}`);
}

function tokenUrl(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);
  url.searchParams.set("token", token);
  return url.toString();
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
