import {
  FollowStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type {
  FollowPageQuery,
  FollowRepository,
  FollowState,
} from "../application/ports/follow-repository.js";
import {
  CannotFollowSelfError,
  FollowConflictError,
} from "../application/ports/follow-repository.js";
import type { FollowListEntry } from "../application/follow-view.js";
import {
  publicAuthorSelect,
  visibleAuthorWhere,
  visibleUserCardWhere,
} from "../../posts/infrastructure/post-query-policy.js";

export class PrismaFollowRepository implements FollowRepository {
  constructor(private readonly database: PrismaClient) {}

  async follow(
    username: string,
    followerId: string,
  ): Promise<FollowState | null> {
    const target = await this.database.user.findFirst({
      where: {
        usernameNormalized: username,
        ...visibleUserCardWhere(followerId),
      },
      select: {
        id: true,
        isPrivateAccount: true,
      },
    });
    if (!target) return null;
    if (target.id === followerId) throw new CannotFollowSelfError();

    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await transaction.follow.findUnique({
          where: {
            followerId_followeeId: {
              followerId,
              followeeId: target.id,
            },
          },
          select: { id: true, status: true },
        });
        if (existing?.status === FollowStatus.ACTIVE) {
          throw new FollowConflictError("already_following");
        }
        if (existing?.status === FollowStatus.PENDING) {
          throw new FollowConflictError("request_pending");
        }

        const nextStatus = target.isPrivateAccount
          ? FollowStatus.PENDING
          : FollowStatus.ACTIVE;
        let followId: string;
        if (existing) {
          const updated = await transaction.follow.updateMany({
            where: { id: existing.id, status: FollowStatus.REJECTED },
            data: { status: nextStatus },
          });
          if (updated.count === 0) {
            throw new FollowConflictError("concurrent_change");
          }
          followId = existing.id;
        } else {
          const created = await transaction.follow.create({
            data: {
              followerId,
              followeeId: target.id,
              status: nextStatus,
            },
            select: { id: true },
          });
          followId = created.id;
        }

        let followerCount: number;
        if (nextStatus === FollowStatus.ACTIVE) {
          const updatedTarget = await transaction.user.update({
            where: { id: target.id },
            data: { followerCount: { increment: 1 } },
            select: { followerCount: true },
          });
          followerCount = updatedTarget.followerCount;
          await transaction.user.update({
            where: { id: followerId },
            data: { followingCount: { increment: 1 } },
          });
        } else {
          const currentTarget = await transaction.user.findUniqueOrThrow({
            where: { id: target.id },
            select: { followerCount: true },
          });
          followerCount = currentTarget.followerCount;
        }
        await transaction.outboxEvent.create({
          data: {
            eventType:
              nextStatus === FollowStatus.PENDING
                ? "follow.requested"
                : "user.followed",
            aggregateType: "follow",
            aggregateId: followId,
            payload: {
              followId,
              actorId: followerId,
              recipientId: target.id,
            },
          },
        });
        return {
          isFollowing: nextStatus === FollowStatus.ACTIVE,
          followRequested: nextStatus === FollowStatus.PENDING,
          followerCount,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const relation = await this.database.follow.findUnique({
          where: {
            followerId_followeeId: {
              followerId,
              followeeId: target.id,
            },
          },
          select: { status: true },
        });
        throw new FollowConflictError(
          relation?.status === FollowStatus.PENDING
            ? "request_pending"
            : "already_following",
        );
      }
      throw error;
    }
  }

  async unfollow(
    username: string,
    followerId: string,
  ): Promise<FollowState | null> {
    const target = await this.database.user.findFirst({
      where: {
        usernameNormalized: username,
        ...visibleUserCardWhere(followerId),
      },
      select: { id: true },
    });
    if (!target) return null;
    if (target.id === followerId) throw new CannotFollowSelfError();

    return this.database.$transaction(async (transaction) => {
      const relation = await transaction.follow.findUnique({
        where: {
          followerId_followeeId: {
            followerId,
            followeeId: target.id,
          },
        },
        select: { id: true, status: true },
      });
      if (!relation || relation.status === FollowStatus.REJECTED) {
        throw new FollowConflictError("not_following");
      }
      await transaction.follow.delete({ where: { id: relation.id } });

      if (relation.status === FollowStatus.ACTIVE) {
        await transaction.user.updateMany({
          where: { id: target.id, followerCount: { gt: 0 } },
          data: { followerCount: { decrement: 1 } },
        });
        await transaction.user.updateMany({
          where: { id: followerId, followingCount: { gt: 0 } },
          data: { followingCount: { decrement: 1 } },
        });
      }
      const currentTarget = await transaction.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { followerCount: true },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: "user.unfollowed",
          aggregateType: "follow",
          aggregateId: relation.id,
          payload: {
            followId: relation.id,
            actorId: followerId,
            recipientId: target.id,
          },
        },
      });
      return {
        isFollowing: false,
        followRequested: false,
        followerCount: currentTarget.followerCount,
      };
    });
  }

  respond(
    followId: string,
    followeeId: string,
    action: "accept" | "reject",
  ): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const request = await transaction.follow.findFirst({
        where: {
          id: followId,
          followeeId,
          status: FollowStatus.PENDING,
          follower: { is: visibleUserCardWhere(followeeId) },
        },
        select: { id: true, followerId: true },
      });
      if (!request) return false;

      const updated = await transaction.follow.updateMany({
        where: { id: request.id, status: FollowStatus.PENDING },
        data: {
          status:
            action === "accept"
              ? FollowStatus.ACTIVE
              : FollowStatus.REJECTED,
        },
      });
      if (updated.count === 0) return false;
      if (action === "accept") {
        await transaction.user.update({
          where: { id: followeeId },
          data: { followerCount: { increment: 1 } },
        });
        await transaction.user.update({
          where: { id: request.followerId },
          data: { followingCount: { increment: 1 } },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: "follow.accepted",
            aggregateType: "follow",
            aggregateId: request.id,
            payload: {
              followId: request.id,
              actorId: followeeId,
              recipientId: request.followerId,
            },
          },
        });
      }
      return true;
    });
  }

  listFollowers(
    username: string,
    query: FollowPageQuery,
  ): Promise<FollowListEntry[] | null> {
    return this.listForUser(username, query, "followers");
  }

  listFollowing(
    username: string,
    query: FollowPageQuery,
  ): Promise<FollowListEntry[] | null> {
    return this.listForUser(username, query, "following");
  }

  listIncoming(
    followeeId: string,
    query: FollowPageQuery,
  ): Promise<FollowListEntry[]> {
    return this.database.follow
      .findMany({
        where: {
          followeeId,
          status: FollowStatus.PENDING,
          follower: { is: visibleUserCardWhere(followeeId) },
          ...cursorWhere(query.before),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: {
          id: true,
          createdAt: true,
          follower: { select: publicAuthorSelect() },
        },
      })
      .then((rows) =>
        rows.map(({ follower, ...entry }) => ({ ...entry, user: follower })),
      );
  }

  private viewerFollowSelect(
    viewerId?: string,
  ): Prisma.UserSelect {
    if (!viewerId) return {};
    return {
      followers: {
        where: {
          followerId: viewerId,
          status: { in: [FollowStatus.ACTIVE, FollowStatus.PENDING] },
        },
        select: { status: true },
        take: 1,
      },
    };
  }

  private async listForUser(
    username: string,
    query: FollowPageQuery,
    direction: "followers" | "following",
  ): Promise<FollowListEntry[] | null> {
    const target = await this.database.user.findFirst({
      where: {
        usernameNormalized: username,
        ...visibleAuthorWhere(query.viewerId),
      },
      select: { id: true },
    });
    if (!target) return null;

    const page = {
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
      take: query.limit + 1,
    };
    if (direction === "followers") {
      const rows = await this.database.follow.findMany({
        where: {
          followeeId: target.id,
          status: FollowStatus.ACTIVE,
          follower: { is: visibleUserCardWhere(query.viewerId) },
          ...cursorWhere(query.before),
        },
        ...page,
        select: {
          id: true,
          createdAt: true,
          follower: {
            select: {
              ...publicAuthorSelect(),
              ...this.viewerFollowSelect(query.viewerId),
            },
          },
        },
      });
      return rows.map(({ follower, ...entry }) => ({
        ...entry,
        user: follower,
      })) as unknown as FollowListEntry[];
    }
    const rows = await this.database.follow.findMany({
      where: {
        followerId: target.id,
        status: FollowStatus.ACTIVE,
        followee: { is: visibleUserCardWhere(query.viewerId) },
        ...cursorWhere(query.before),
      },
      ...page,
      select: {
        id: true,
        createdAt: true,
        followee: {
          select: {
            ...publicAuthorSelect(),
            ...this.viewerFollowSelect(query.viewerId),
          },
        },
      },
    });
    return rows.map(({ followee, ...entry }) => ({
      ...entry,
      user: followee,
    })) as unknown as FollowListEntry[];
  }
}

function cursorWhere(
  before: FollowPageQuery["before"],
): Prisma.FollowWhereInput {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}
