import type { Prisma, PrismaClient } from "@prisma/client";
import { SubscriptionStatus } from "@prisma/client";

import type { PostAuthorViewRecord } from "../../posts/application/post-view.js";
import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";
import type {
  ProfileViewListQuery,
  ProfileViewRecord,
  ProfileViewRepository,
} from "../application/ports/profile-view-repository.js";

export class PrismaProfileViewRepository implements ProfileViewRepository {
  constructor(private readonly database: PrismaClient) {}

  async upsertView(profileUserId: string, viewerId: string): Promise<void> {
    if (profileUserId === viewerId) return;

    const [viewer, profileUser, block] = await Promise.all([
      this.database.user.findUnique({
        where: { id: viewerId },
        select: {
          id: true,
          role: true,
          isSystemAccount: true,
          status: true,
        },
      }),
      this.database.user.findUnique({
        where: { id: profileUserId },
        select: { id: true, role: true, status: true },
      }),
      this.database.block.findFirst({
        where: {
          OR: [
            { blockerId: profileUserId, blockedId: viewerId },
            { blockerId: viewerId, blockedId: profileUserId },
          ],
        },
        select: { blockerId: true },
      }),
    ]);

    if (!viewer || !profileUser) return;
    if (viewer.status !== "ACTIVE" || profileUser.status !== "ACTIVE") return;
    if (viewer.role !== "USER" || profileUser.role !== "USER") return;
    if (viewer.isSystemAccount) return;
    if (block) return;

    const now = new Date();
    await this.database.profileView.upsert({
      where: {
        profileUserId_viewerId: { profileUserId, viewerId },
      },
      create: { profileUserId, viewerId, viewedAt: now },
      update: { viewedAt: now },
    });
  }

  async countViews(profileUserId: string): Promise<number> {
    return this.database.profileView.count({
      where: this.visibleViewWhere(profileUserId),
    });
  }

  async listViews(
    profileUserId: string,
    query: ProfileViewListQuery,
  ): Promise<ProfileViewRecord[]> {
    const rows = await this.database.profileView.findMany({
      where: {
        ...this.visibleViewWhere(profileUserId),
        ...(query.before
          ? {
              OR: [
                { updatedAt: { lt: query.before.updatedAt } },
                {
                  updatedAt: query.before.updatedAt,
                  viewerId: { lt: query.before.viewerId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { viewerId: "desc" }],
      take: query.limit,
      select: {
        viewerId: true,
        viewedAt: true,
        updatedAt: true,
        viewer: { select: publicAuthorSelect() },
      },
    });

    return rows.map((row) => ({
      viewerId: row.viewerId,
      viewedAt: row.viewedAt,
      updatedAt: row.updatedAt,
      viewer: row.viewer as PostAuthorViewRecord,
    }));
  }

  private visibleViewWhere(profileUserId: string): Prisma.ProfileViewWhereInput {
    return {
      profileUserId,
      viewer: {
        role: "USER",
        isSystemAccount: false,
        status: "ACTIVE",
        blocksInitiated: { none: { blockedId: profileUserId } },
        blocksReceived: { none: { blockerId: profileUserId } },
      },
    };
  }
}

export async function readPremiumStatus(
  database: PrismaClient,
  userId: string,
): Promise<{ isPremium: boolean; premiumExpiresAt: Date | null }> {
  const now = new Date();
  const subscription = await database.userSubscription.findFirst({
    where: {
      userId,
      status: SubscriptionStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
      cancelledAt: null,
    },
    orderBy: { endsAt: "desc" },
    select: { endsAt: true },
  });

  return {
    isPremium: Boolean(subscription),
    premiumExpiresAt: subscription?.endsAt ?? null,
  };
}
