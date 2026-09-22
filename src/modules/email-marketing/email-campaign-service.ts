import { createHmac, timingSafeEqual } from "node:crypto";

import {
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailJobStatus,
  EmailJobType,
  Prisma,
  UserRole,
  UserStatus,
  type EmailCampaign,
  type PrismaClient,
} from "@prisma/client";

import { AppError } from "../../shared/errors/app-error.js";

export const MAX_CAMPAIGN_RECIPIENTS = 5_000;

export type CampaignAudienceInput = {
  inactiveDays: number;
  requireEmailVerified: boolean;
};

function audienceWhere(
  input: CampaignAudienceInput,
  now = new Date(),
): Prisma.UserWhereInput {
  const cutoff = new Date(
    now.getTime() - input.inactiveDays * 24 * 60 * 60 * 1_000,
  );
  return {
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    isSystemAccount: false,
    marketingEmailOptOut: false,
    ...(input.requireEmailVerified ? { emailVerifiedAt: { not: null } } : {}),
    OR: [
      { lastSeenAt: { lt: cutoff } },
      { lastSeenAt: null, createdAt: { lt: cutoff } },
    ],
  };
}

export function marketingUnsubscribeToken(
  userId: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`marketing-unsub:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyMarketingUnsubscribeToken(
  userId: string,
  token: string,
  secret: string,
): boolean {
  const expected = marketingUnsubscribeToken(userId, secret);
  try {
    return timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(String(token).trim()),
    );
  } catch {
    return false;
  }
}

export function buildUnsubscribeUrl(
  publicWebOrigin: string,
  userId: string,
  secret: string,
): string {
  const base = publicWebOrigin.replace(/\/+$/, "");
  const token = marketingUnsubscribeToken(userId, secret);
  return `${base}/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

export function presentEmailCampaign(row: EmailCampaign) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    htmlBody: row.htmlBody,
    textBody: row.textBody,
    audienceInactiveDays: row.audienceInactiveDays,
    requireEmailVerified: row.requireEmailVerified,
    status: row.status,
    createdByAdminId: row.createdByAdminId,
    queuedAt: row.queuedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    totalRecipients: row.totalRecipients,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    skippedCount: row.skippedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class EmailCampaignService {
  constructor(
    private readonly database: PrismaClient,
    private readonly encryptionSecret: string,
    private readonly publicWebOrigin: string,
  ) {}

  async previewAudience(input: CampaignAudienceInput): Promise<{
    count: number;
    inactiveDays: number;
    requireEmailVerified: boolean;
    cappedAt: number;
  }> {
    const count = await this.database.user.count({
      where: audienceWhere(input),
    });
    return {
      count: Math.min(count, MAX_CAMPAIGN_RECIPIENTS),
      inactiveDays: input.inactiveDays,
      requireEmailVerified: input.requireEmailVerified,
      cappedAt: MAX_CAMPAIGN_RECIPIENTS,
    };
  }

  async listCampaigns(options: { page: number; pageSize: number }) {
    const skip = (options.page - 1) * options.pageSize;
    const [items, total] = await Promise.all([
      this.database.emailCampaign.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: options.pageSize,
      }),
      this.database.emailCampaign.count(),
    ]);
    return {
      items: items.map(presentEmailCampaign),
      page: options.page,
      pageSize: options.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / options.pageSize)),
    };
  }

  async getCampaign(campaignId: string) {
    const row = await this.database.emailCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!row) {
      throw new AppError("NOT_FOUND", "Campaign not found", 404);
    }
    return presentEmailCampaign(row);
  }

  async createDraft(
    adminId: string,
    input: {
      name: string;
      subject: string;
      htmlBody: string;
      textBody: string;
      audienceInactiveDays: number;
      requireEmailVerified: boolean;
    },
  ) {
    const row = await this.database.emailCampaign.create({
      data: {
        name: input.name.trim(),
        subject: input.subject.trim(),
        htmlBody: input.htmlBody.trim(),
        textBody: input.textBody.trim(),
        audienceInactiveDays: input.audienceInactiveDays,
        requireEmailVerified: input.requireEmailVerified,
        status: EmailCampaignStatus.DRAFT,
        createdByAdminId: adminId,
      },
    });
    return presentEmailCampaign(row);
  }

  async launchCampaign(adminId: string, campaignId: string) {
    const campaign = await this.database.emailCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new AppError("NOT_FOUND", "Campaign not found", 404);
    }
    if (campaign.status !== EmailCampaignStatus.DRAFT) {
      throw new AppError(
        "INVALID_STATE",
        "Only draft campaigns can be launched",
        400,
      );
    }

    const users = await this.database.user.findMany({
      where: audienceWhere({
        inactiveDays: campaign.audienceInactiveDays,
        requireEmailVerified: campaign.requireEmailVerified,
      }),
      select: { id: true, email: true },
      orderBy: { lastSeenAt: "asc" },
      take: MAX_CAMPAIGN_RECIPIENTS,
    });

    if (users.length === 0) {
      throw new AppError(
        "EMPTY_AUDIENCE",
        "No users match this audience right now",
        400,
      );
    }

    const now = new Date();
    await this.database.$transaction(async (tx) => {
      const claimed = await tx.emailCampaign.updateMany({
        where: { id: campaignId, status: EmailCampaignStatus.DRAFT },
        data: {
          status: EmailCampaignStatus.QUEUED,
          queuedAt: now,
          startedAt: now,
          totalRecipients: users.length,
          sentCount: 0,
          failedCount: 0,
          skippedCount: 0,
        },
      });
      if (claimed.count !== 1) {
        throw new AppError(
          "INVALID_STATE",
          "Campaign was already launched",
          409,
        );
      }

      for (const user of users) {
        const recipient = await tx.emailCampaignRecipient.create({
          data: {
            campaignId,
            userId: user.id,
            toEmail: user.email,
            status: EmailCampaignRecipientStatus.PENDING,
          },
        });

        const unsubscribeUrl = buildUnsubscribeUrl(
          this.publicWebOrigin,
          user.id,
          this.encryptionSecret,
        );
        const html = injectUnsubscribe(campaign.htmlBody, unsubscribeUrl);
        const text = `${campaign.textBody.trim()}\n\nUnsubscribe: ${unsubscribeUrl}`;

        const job = await tx.emailJob.create({
          data: {
            type: EmailJobType.MARKETING,
            toEmail: user.email,
            payload: {
              campaignId,
              recipientId: recipient.id,
              userId: user.id,
              subject: campaign.subject,
              html,
              text,
            },
            availableAt: now,
          },
        });

        await tx.emailCampaignRecipient.update({
          where: { id: recipient.id },
          data: { emailJobId: job.id },
        });
      }

      await tx.emailCampaign.update({
        where: { id: campaignId },
        data: { status: EmailCampaignStatus.SENDING },
      });

      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorUserId: adminId,
          action: "admin.email_campaign.launched",
          resourceType: "email_campaign",
          resourceId: campaignId,
          metadata: { recipients: users.length },
        },
      });
    });

    return this.getCampaign(campaignId);
  }

  async cancelCampaign(adminId: string, campaignId: string) {
    const campaign = await this.database.emailCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new AppError("NOT_FOUND", "Campaign not found", 404);
    }
    if (
      campaign.status !== EmailCampaignStatus.QUEUED &&
      campaign.status !== EmailCampaignStatus.SENDING &&
      campaign.status !== EmailCampaignStatus.DRAFT
    ) {
      throw new AppError(
        "INVALID_STATE",
        "Campaign cannot be cancelled in its current state",
        400,
      );
    }

    await this.database.$transaction(async (tx) => {
      await tx.emailCampaign.update({
        where: { id: campaignId },
        data: {
          status: EmailCampaignStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      const pending = await tx.emailCampaignRecipient.findMany({
        where: {
          campaignId,
          status: EmailCampaignRecipientStatus.PENDING,
        },
        select: { id: true, emailJobId: true },
      });

      if (pending.length > 0) {
        await tx.emailCampaignRecipient.updateMany({
          where: {
            campaignId,
            status: EmailCampaignRecipientStatus.PENDING,
          },
          data: { status: EmailCampaignRecipientStatus.SKIPPED },
        });
        const jobIds = pending
          .map((row) => row.emailJobId)
          .filter((id): id is string => Boolean(id));
        if (jobIds.length > 0) {
          await tx.emailJob.updateMany({
            where: {
              id: { in: jobIds },
              status: {
                in: [EmailJobStatus.PENDING, EmailJobStatus.PROCESSING],
              },
            },
            data: {
              status: EmailJobStatus.FAILED,
              lastError: "Campaign cancelled",
              lockedAt: null,
            },
          });
        }
        await tx.emailCampaign.update({
          where: { id: campaignId },
          data: { skippedCount: { increment: pending.length } },
        });
      }

      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorUserId: adminId,
          action: "admin.email_campaign.cancelled",
          resourceType: "email_campaign",
          resourceId: campaignId,
          metadata: {},
        },
      });
    });

    return this.getCampaign(campaignId);
  }

  async optOutFromMarketing(userId: string, token: string): Promise<void> {
    if (
      !verifyMarketingUnsubscribeToken(userId, token, this.encryptionSecret)
    ) {
      throw new AppError("INVALID_TOKEN", "Unsubscribe link is invalid", 400);
    }
    await this.database.user.updateMany({
      where: { id: userId },
      data: { marketingEmailOptOut: true },
    });
  }
}

function injectUnsubscribe(html: string, unsubscribeUrl: string): string {
  const footer = `<hr style="border:none;border-top:1px solid #333;margin:28px 0 16px"/><p style="font-size:12px;color:#a1a1aa;line-height:1.5">You received this because you have a Milox account. <a href="${unsubscribeUrl}" style="color:#c4b5fd">Unsubscribe from marketing emails</a>.</p>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${footer}</body>`);
  }
  return `${html}${footer}`;
}

/** Called by email worker after a marketing job succeeds or fails. */
export async function markMarketingRecipientResult(
  database: PrismaClient,
  payload: {
    campaignId: string;
    recipientId: string;
  },
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  await database.$transaction(async (tx) => {
    const recipient = await tx.emailCampaignRecipient.findUnique({
      where: { id: payload.recipientId },
    });
    if (!recipient || recipient.status !== EmailCampaignRecipientStatus.PENDING) {
      return;
    }

    if (result.ok) {
      await tx.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: EmailCampaignRecipientStatus.SENT,
          sentAt: new Date(),
          lastError: null,
        },
      });
      await tx.emailCampaign.update({
        where: { id: payload.campaignId },
        data: { sentCount: { increment: 1 } },
      });
    } else {
      await tx.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: EmailCampaignRecipientStatus.FAILED,
          lastError: result.error.slice(0, 1000),
        },
      });
      await tx.emailCampaign.update({
        where: { id: payload.campaignId },
        data: { failedCount: { increment: 1 } },
      });
    }

    const campaign = await tx.emailCampaign.findUnique({
      where: { id: payload.campaignId },
    });
    if (!campaign || campaign.status === EmailCampaignStatus.CANCELLED) {
      return;
    }

    const pendingLeft = await tx.emailCampaignRecipient.count({
      where: {
        campaignId: payload.campaignId,
        status: EmailCampaignRecipientStatus.PENDING,
      },
    });
    if (pendingLeft === 0) {
      await tx.emailCampaign.update({
        where: { id: payload.campaignId },
        data: {
          status: EmailCampaignStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
    }
  });
}
