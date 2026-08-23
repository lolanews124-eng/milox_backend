import {
  CallEndReason,
  CallSessionStatus,
  ConversationKind,
  MatchStatus,
  MessageType,
  WalletTransactionType,
  type CallSession,
  type PrismaClient,
} from "@prisma/client";
import type { Server } from "socket.io";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { activeConversationWhere } from "../../chat/infrastructure/chat-query-policy.js";
import {
  ensureAppEconomyConfig,
  presentEconomyConfig,
} from "../../economy/app-economy-config.js";
import {
  debitWallet,
  InsufficientWalletBalanceError,
} from "../../rewards/infrastructure/prisma-rewards-repository.js";
import { buildIceServers, type IceServerConfig } from "../ice-servers.js";

const BILLING_INTERVAL_MS = 5_000;

export type CallSessionView = {
  id: string;
  conversationId: string;
  matchId: string;
  callerId: string;
  calleeId: string;
  status: CallSessionStatus;
  endReason: CallEndReason | null;
  ringingAt: string;
  startedAt: string | null;
  endedAt: string | null;
  billedMinutes: number;
  pointsCharged: number;
  pointsPerMinute: number;
  iceServers: IceServerConfig[];
};

export type LiveCallView = {
  id: string;
  conversationId: string;
  callerId: string;
  callerUsername: string;
  calleeId: string;
  calleeUsername: string;
  status: CallSessionStatus;
  ringingAt: string;
  startedAt: string | null;
  billedMinutes: number;
  pointsCharged: number;
  iceRestartCount: number;
  poorNetworkEvents: number;
  connectedSeconds: number;
};

export type CallHistoryItemView = {
  id: string;
  conversationId: string;
  peerName: string;
  outgoing: boolean;
  missed: boolean;
  billedMinutes: number;
  ringingAt: string;
  endedAt: string | null;
};

export type IncomingCallPush = {
  callId: string;
  conversationId: string;
  callerId: string;
  callerUsername: string;
  callerDisplayName: string | null;
  callerPhotoUrl: string | null;
  pointsPerMinute: number;
};

type CallEmitter = {
  emitToUser: (userId: string, event: string, payload: unknown) => void;
  onIncomingCall?:
    ((userId: string, payload: IncomingCallPush) => void) | undefined;
};

type BillingPayload = {
  callId: string;
  billedMinutes: number;
  pointsCharged: number;
  pointsPerMinute: number;
  callerBalance: number;
  remainingMinutes: number;
  lowBalance: boolean;
};

export class CallService {
  private readonly billingTimers = new Map<string, NodeJS.Timeout>();
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  private emitter: CallEmitter | null = null;
  private pointsPerMinuteCache = 40;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  attachIo(io: Server): void {
    const previousHandler = this.emitter?.onIncomingCall;
    this.emitter = {
      emitToUser: (userId, event, payload) => {
        io.to(`user:${userId}`).emit(event, payload);
      },
      onIncomingCall: previousHandler,
    };
  }

  setIncomingCallHandler(
    handler: (userId: string, payload: IncomingCallPush) => void,
  ): void {
    if (!this.emitter) {
      this.emitter = {
        emitToUser: () => undefined,
        onIncomingCall: handler,
      };
      return;
    }
    this.emitter.onIncomingCall = handler;
  }

  async getIceServers(
    userId: string,
  ): Promise<{ iceServers: IceServerConfig[] }> {
    return { iceServers: buildIceServers(this.config, userId) };
  }

  async economySummary() {
    return presentEconomyConfig(await ensureAppEconomyConfig(this.database));
  }

  async createCall(
    callerId: string,
    conversationId: string,
  ): Promise<CallSessionView> {
    const economy = await ensureAppEconomyConfig(this.database);
    if (!economy.videoCallEnabled) {
      throw new AppError(
        "VIDEO_CALL_DISABLED",
        "Video calls are currently disabled",
        403,
      );
    }
    const rate = economy.videoCallPointsPerMinute;
    this.pointsPerMinuteCache = rate;

    const conversation = await this.database.conversation.findFirst({
      where: {
        AND: [
          activeConversationWhere(callerId, conversationId),
          { kind: ConversationKind.MATCH, matchId: { not: null } },
        ],
      },
      select: {
        id: true,
        matchId: true,
        match: {
          select: {
            id: true,
            status: true,
            userAId: true,
            userBId: true,
          },
        },
        members: {
          where: { leftAt: null },
          select: { userId: true },
        },
      },
    });

    if (
      !conversation?.match ||
      conversation.match.status !== MatchStatus.ACTIVE
    ) {
      throw new AppError(
        "CALL_NOT_ALLOWED",
        "Video calls are only available after mutual interest in an active match chat",
        403,
      );
    }

    const peerId =
      conversation.match.userAId === callerId
        ? conversation.match.userBId
        : conversation.match.userAId;

    if (!conversation.members.some((member) => member.userId === peerId)) {
      throw new AppError(
        "CALL_NOT_ALLOWED",
        "Peer is not in this conversation",
        403,
      );
    }

    const wallet = await this.database.wallet.findUnique({
      where: { userId: callerId },
      select: { balance: true },
    });
    if (!wallet || wallet.balance < rate) {
      throw new AppError(
        "INSUFFICIENT_WALLET_BALANCE",
        `You need at least ${rate} Milox Points to start a video call`,
        402,
      );
    }

    // Anti-spam: max 3 calls to the same peer in 10 minutes.
    const peerSpamWindowStart = new Date(Date.now() - 10 * 60 * 1000);
    const recentToPeer = await this.database.callSession.count({
      where: {
        callerId,
        calleeId: peerId,
        ringingAt: { gte: peerSpamWindowStart },
      },
    });
    if (recentToPeer >= 3) {
      throw new AppError(
        "CALL_RATE_LIMITED",
        "Too many calls to this person. Wait a few minutes before trying again.",
        429,
      );
    }

    // Cooldown after any ended call with this peer (30s).
    const lastWithPeer = await this.database.callSession.findFirst({
      where: {
        OR: [
          { callerId, calleeId: peerId },
          { callerId: peerId, calleeId: callerId },
        ],
        status: CallSessionStatus.ENDED,
      },
      orderBy: { endedAt: "desc" },
      select: { endedAt: true },
    });
    if (
      lastWithPeer?.endedAt &&
      Date.now() - lastWithPeer.endedAt.getTime() < 30_000
    ) {
      throw new AppError(
        "CALL_COOLDOWN",
        "Please wait a moment before calling again.",
        429,
      );
    }

    const caller = await this.database.user.findUnique({
      where: { id: callerId },
      select: {
        username: true,
        displayName: true,
        profilePhotoMediaId: true,
      },
    });
    if (!caller) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }

    const matchId = conversation.match.id;

    const session = await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"call:" + callerId}), hashtext(${"call:" + peerId}))`;

      const busy = await tx.callSession.findFirst({
        where: {
          status: {
            in: [CallSessionStatus.RINGING, CallSessionStatus.ACTIVE],
          },
          OR: [
            { callerId },
            { calleeId: callerId },
            { callerId: peerId },
            { calleeId: peerId },
          ],
        },
        select: { id: true },
      });
      if (busy) {
        throw new AppError(
          "CALL_BUSY",
          "You or the other person is already on a call",
          409,
        );
      }

      return tx.callSession.create({
        data: {
          conversationId: conversation.id,
          matchId,
          callerId,
          calleeId: peerId,
          status: CallSessionStatus.RINGING,
        },
      });
    });

    // Charge minute 1 as soon as ringing starts (even if never answered).
    try {
      await this.chargeMinute(session, 1, rate);
    } catch (error) {
      if (!(error instanceof InsufficientWalletBalanceError)) {
        throw error;
      }
      await this.finishCall(session, CallEndReason.INSUFFICIENT_POINTS);
      throw new AppError(
        "INSUFFICIENT_WALLET_BALANCE",
        `You need at least ${rate} Milox Points to start a video call`,
        402,
      );
    }

    const billed = await this.database.callSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const view = this.present(billed, rate, callerId);
    const callerPhotoUrl = mediaUrl(
      caller.profilePhotoMediaId,
      this.config,
    );
    this.emitter?.emitToUser(peerId, "call:invite", {
      call: view,
      caller: {
        id: callerId,
        username: caller.username,
        displayName: caller.displayName,
        profilePhotoUrl: callerPhotoUrl,
      },
    });
    this.emitter?.onIncomingCall?.(peerId, {
      callId: session.id,
      conversationId: session.conversationId,
      callerId,
      callerUsername: caller.username,
      callerDisplayName: caller.displayName,
      callerPhotoUrl,
      pointsPerMinute: rate,
    });

    const billing = await this.buildBillingPayload(billed, rate);
    this.emitter?.emitToUser(callerId, "call:billing", billing);
    this.emitter?.emitToUser(peerId, "call:billing", billing);

    this.scheduleRingTimeout(session.id, economy.videoCallRingTimeoutSec);
    this.startBillingLoop(session.id, rate);
    return view;
  }

  async acceptCall(callId: string, userId: string): Promise<CallSessionView> {
    const economy = await ensureAppEconomyConfig(this.database);
    if (!economy.videoCallEnabled) {
      throw new AppError(
        "VIDEO_CALL_DISABLED",
        "Video calls are currently disabled",
        403,
      );
    }
    const rate = economy.videoCallPointsPerMinute;
    this.pointsPerMinuteCache = rate;

    const session = await this.database.callSession.findUnique({
      where: { id: callId },
    });
    if (!session || session.calleeId !== userId) {
      throw new AppError("CALL_NOT_FOUND", "Incoming call not found", 404);
    }
    if (session.status !== CallSessionStatus.RINGING) {
      throw new AppError(
        "CALL_STATE_CONFLICT",
        "Call is no longer ringing",
        409,
      );
    }

    const match = await this.database.match.findUnique({
      where: { id: session.matchId },
      select: { status: true },
    });
    if (!match || match.status !== MatchStatus.ACTIVE) {
      await this.finishCall(session, CallEndReason.UNMATCH);
      throw new AppError(
        "CALL_NOT_ALLOWED",
        "This match is no longer active",
        403,
      );
    }

    const wallet = await this.database.wallet.findUnique({
      where: { userId: session.callerId },
      select: { balance: true },
    });
    // Minute 1 is already charged at ring; only block accept if that failed.
    if (session.billedMinutes < 1 && (!wallet || wallet.balance < rate)) {
      await this.finishCall(session, CallEndReason.INSUFFICIENT_POINTS);
      throw new AppError(
        "INSUFFICIENT_WALLET_BALANCE",
        "Caller does not have enough points for this call",
        402,
      );
    }

    const activated = await this.database.callSession.updateMany({
      where: { id: callId, status: CallSessionStatus.RINGING },
      data: {
        status: CallSessionStatus.ACTIVE,
        startedAt: new Date(),
      },
    });
    if (activated.count === 0) {
      throw new AppError(
        "CALL_STATE_CONFLICT",
        "Call is no longer ringing",
        409,
      );
    }
    this.clearRingTimeout(callId);

    let updated = await this.database.callSession.findUniqueOrThrow({
      where: { id: callId },
    });

    // Safety: if ring charge somehow missed, charge minute 1 now.
    if (updated.billedMinutes < 1) {
      try {
        await this.chargeMinute(updated, 1, rate);
      } catch (error) {
        if (!(error instanceof InsufficientWalletBalanceError)) {
          throw error;
        }
        await this.finishCall(updated, CallEndReason.INSUFFICIENT_POINTS);
        throw new AppError(
          "INSUFFICIENT_WALLET_BALANCE",
          "Caller does not have enough points for this call",
          402,
        );
      }
      updated = await this.database.callSession.findUniqueOrThrow({
        where: { id: callId },
      });
    }

    const view = this.present(updated, rate, userId);
    this.emitter?.emitToUser(session.callerId, "call:accepted", { call: view });
    this.emitter?.emitToUser(session.calleeId, "call:accepted", { call: view });
    this.startBillingLoop(callId, rate);
    return view;
  }

  async rejectCall(callId: string, userId: string): Promise<void> {
    const session = await this.requireParticipant(callId, userId);
    if (session.status !== CallSessionStatus.RINGING) {
      throw new AppError(
        "CALL_STATE_CONFLICT",
        "Call is no longer ringing",
        409,
      );
    }
    if (session.calleeId !== userId) {
      throw new AppError("FORBIDDEN", "Only the callee can reject a call", 403);
    }
    await this.finishCall(session, CallEndReason.REJECT);
    const payload = { callId, conversationId: session.conversationId };
    this.emitter?.emitToUser(session.callerId, "call:rejected", payload);
    this.emitter?.emitToUser(session.calleeId, "call:rejected", payload);
  }

  async endCall(callId: string, userId: string): Promise<CallSessionView> {
    const session = await this.requireParticipant(callId, userId);
    if (session.status === CallSessionStatus.ENDED) {
      return this.present(session, this.pointsPerMinuteCache, userId);
    }
    const ended = await this.finishCall(session, CallEndReason.HANGUP);
    return this.present(ended, this.pointsPerMinuteCache, userId);
  }

  async endCallsForConversation(
    conversationId: string,
    reason: CallEndReason = CallEndReason.UNMATCH,
  ): Promise<void> {
    const live = await this.database.callSession.findMany({
      where: {
        conversationId,
        status: { in: [CallSessionStatus.RINGING, CallSessionStatus.ACTIVE] },
      },
    });
    for (const session of live) {
      await this.finishCall(session, reason);
    }
  }

  /**
   * Multi-instance safety net for ring timeouts and minute billing.
   * In-memory timers remain the fast path on the owning process.
   */
  async processDueCallTimers(): Promise<void> {
    const economy = await ensureAppEconomyConfig(this.database);
    const rate = economy.videoCallPointsPerMinute;
    this.pointsPerMinuteCache = rate;
    const now = Date.now();
    const ringTimeoutMs = Math.max(5, economy.videoCallRingTimeoutSec) * 1000;
    const ringDeadline = new Date(now - ringTimeoutMs);

    const timedOut = await this.database.callSession.findMany({
      where: {
        status: CallSessionStatus.RINGING,
        ringingAt: { lt: ringDeadline },
      },
      take: 50,
      orderBy: { ringingAt: "asc" },
    });
    for (const session of timedOut) {
      await this.finishCall(session, CallEndReason.TIMEOUT);
    }

    const active = await this.database.callSession.findMany({
      where: {
        status: {
          in: [CallSessionStatus.RINGING, CallSessionStatus.ACTIVE],
        },
      },
      take: 100,
      orderBy: { ringingAt: "asc" },
    });
    for (const session of active) {
      // Bill continuously from ring start (not only after accept).
      const dueAt =
        session.ringingAt.getTime() + session.billedMinutes * 60_000;
      if (dueAt > now) continue;

      const nextMinute = session.billedMinutes + 1;
      try {
        await this.chargeMinute(session, nextMinute, rate);
        const refreshed = await this.database.callSession.findUniqueOrThrow({
          where: { id: session.id },
        });
        if (
          refreshed.status !== CallSessionStatus.RINGING &&
          refreshed.status !== CallSessionStatus.ACTIVE
        ) {
          continue;
        }
        const payload = await this.buildBillingPayload(refreshed, rate);
        this.emitter?.emitToUser(session.callerId, "call:billing", payload);
        this.emitter?.emitToUser(session.calleeId, "call:billing", payload);
      } catch (error) {
        if (!(error instanceof InsufficientWalletBalanceError)) {
          continue;
        }
        await this.finishCall(session, CallEndReason.INSUFFICIENT_POINTS);
      }
    }
  }

  async listLiveCalls(): Promise<LiveCallView[]> {
    const sessions = await this.database.callSession.findMany({
      where: {
        status: { in: [CallSessionStatus.RINGING, CallSessionStatus.ACTIVE] },
      },
      select: {
        id: true,
        conversationId: true,
        callerId: true,
        calleeId: true,
        status: true,
        ringingAt: true,
        startedAt: true,
        billedMinutes: true,
        pointsCharged: true,
        iceRestartCount: true,
        poorNetworkEvents: true,
        connectedSeconds: true,
        caller: { select: { username: true } },
        callee: { select: { username: true } },
      },
      orderBy: { ringingAt: "desc" },
      take: 200,
    });
    return sessions.map((session) => ({
      id: session.id,
      conversationId: session.conversationId,
      callerId: session.callerId,
      callerUsername: session.caller.username,
      calleeId: session.calleeId,
      calleeUsername: session.callee.username,
      status: session.status,
      ringingAt: session.ringingAt.toISOString(),
      startedAt: session.startedAt?.toISOString() ?? null,
      billedMinutes: session.billedMinutes,
      pointsCharged: session.pointsCharged,
      iceRestartCount: session.iceRestartCount,
      poorNetworkEvents: session.poorNetworkEvents,
      connectedSeconds: session.connectedSeconds,
    }));
  }

  async forceEndCall(
    callId: string,
    staffUserId: string,
  ): Promise<CallSessionView> {
    const session = await this.database.callSession.findUnique({
      where: { id: callId },
    });
    if (!session) {
      throw new AppError("CALL_NOT_FOUND", "Call not found", 404);
    }
    const economy = await ensureAppEconomyConfig(this.database);
    if (session.status === CallSessionStatus.ENDED) {
      return this.present(session, economy.videoCallPointsPerMinute, staffUserId);
    }
    const ended = await this.finishCall(session, CallEndReason.ERROR);
    return this.present(ended, economy.videoCallPointsPerMinute, staffUserId);
  }

  async reportQuality(
    callId: string,
    userId: string,
    input: {
      iceRestartCount?: number;
      poorNetworkEvents?: number;
      connectedSeconds?: number;
    },
  ): Promise<void> {
    await this.requireParticipant(callId, userId);
    const clamp = (value: number, max: number) =>
      Math.max(0, Math.min(max, Math.floor(value)));
    await this.database.callSession.update({
      where: { id: callId },
      data: {
        ...(input.iceRestartCount !== undefined
          ? { iceRestartCount: clamp(input.iceRestartCount, 100) }
          : {}),
        ...(input.poorNetworkEvents !== undefined
          ? { poorNetworkEvents: clamp(input.poorNetworkEvents, 100) }
          : {}),
        ...(input.connectedSeconds !== undefined
          ? { connectedSeconds: clamp(input.connectedSeconds, 86_400) }
          : {}),
      },
    });
  }

  async relaySignal(
    userId: string,
    payload: {
      callId: string;
      type: "offer" | "answer" | "ice" | "renegotiate";
      sdp?: unknown;
      candidate?: unknown;
    },
  ): Promise<void> {
    const session = await this.requireParticipant(payload.callId, userId);
    if (
      session.status !== CallSessionStatus.ACTIVE &&
      session.status !== CallSessionStatus.RINGING
    ) {
      throw new AppError("CALL_STATE_CONFLICT", "Call is not active", 409);
    }
    const peerId =
      session.callerId === userId ? session.calleeId : session.callerId;
    this.emitter?.emitToUser(peerId, `call:${payload.type}`, {
      callId: payload.callId,
      fromUserId: userId,
      sdp: payload.sdp ?? null,
      candidate: payload.candidate ?? null,
    });
  }

  private async requireParticipant(
    callId: string,
    userId: string,
  ): Promise<CallSession> {
    const session = await this.database.callSession.findUnique({
      where: { id: callId },
    });
    if (
      !session ||
      (session.callerId !== userId && session.calleeId !== userId)
    ) {
      throw new AppError("CALL_NOT_FOUND", "Call not found", 404);
    }
    return session;
  }

  private scheduleRingTimeout(callId: string, timeoutSec: number): void {
    this.clearRingTimeout(callId);
    const timer = setTimeout(
      () => {
        void this.database.callSession
          .findUnique({ where: { id: callId } })
          .then(async (session) => {
            if (session?.status === CallSessionStatus.RINGING) {
              await this.finishCall(session, CallEndReason.TIMEOUT);
            }
          })
          .catch(() => undefined);
      },
      Math.max(5, timeoutSec) * 1000,
    );
    this.ringTimers.set(callId, timer);
  }

  private clearRingTimeout(callId: string): void {
    const timer = this.ringTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringTimers.delete(callId);
    }
  }

  private startBillingLoop(callId: string, rate: number): void {
    this.stopBillingLoop(callId);
    const timer = setInterval(() => {
      void this.database.callSession
        .findUnique({ where: { id: callId } })
        .then(async (session) => {
          if (
            !session ||
            (session.status !== CallSessionStatus.ACTIVE &&
              session.status !== CallSessionStatus.RINGING)
          ) {
            this.stopBillingLoop(callId);
            return;
          }
          const nextMinute = session.billedMinutes + 1;
          const dueAt =
            session.ringingAt.getTime() + session.billedMinutes * 60_000;
          if (Date.now() < dueAt) {
            return;
          }
          try {
            await this.chargeMinute(session, nextMinute, rate);
            const refreshed = await this.database.callSession.findUniqueOrThrow(
              {
                where: { id: callId },
              },
            );
            const payload = await this.buildBillingPayload(refreshed, rate);
            this.emitter?.emitToUser(session.callerId, "call:billing", payload);
            this.emitter?.emitToUser(session.calleeId, "call:billing", payload);
          } catch (error) {
            if (!(error instanceof InsufficientWalletBalanceError)) {
              return;
            }
            await this.finishCall(session, CallEndReason.INSUFFICIENT_POINTS);
          }
        })
        .catch(() => undefined);
    }, BILLING_INTERVAL_MS);
    this.billingTimers.set(callId, timer);
  }

  private stopBillingLoop(callId: string): void {
    const timer = this.billingTimers.get(callId);
    if (timer) {
      clearInterval(timer);
      this.billingTimers.delete(callId);
    }
  }

  private async buildBillingPayload(
    session: CallSession,
    rate: number,
  ): Promise<BillingPayload> {
    const wallet = await this.database.wallet.findUnique({
      where: { userId: session.callerId },
      select: { balance: true },
    });
    const callerBalance = wallet?.balance ?? 0;
    const remainingMinutes =
      rate > 0 ? Math.floor(callerBalance / rate) : 0;
    return {
      callId: session.id,
      billedMinutes: session.billedMinutes,
      pointsCharged: session.pointsCharged,
      pointsPerMinute: rate,
      callerBalance,
      remainingMinutes,
      lowBalance: remainingMinutes <= 1,
    };
  }

  private async chargeMinute(
    session: CallSession,
    minuteNumber: number,
    rate: number,
  ): Promise<void> {
    const idempotencyKey = `call:${session.id}:minute:${minuteNumber}`;
    try {
      await this.database.$transaction(async (tx) => {
        const alreadyCharged = await tx.walletTransaction.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (alreadyCharged) {
          return;
        }
        await debitWallet(tx, {
          userId: session.callerId,
          amount: rate,
          type: WalletTransactionType.VIDEO_CALL,
          idempotencyKey,
          referenceType: "video_call",
          referenceId: session.id,
          description: `Video call minute ${minuteNumber}`,
        });
        await tx.callSession.update({
          where: { id: session.id },
          data: {
            billedMinutes: minuteNumber,
            pointsCharged: { increment: rate },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return;
      }
      if (error instanceof InsufficientWalletBalanceError) {
        throw error;
      }
      throw error;
    }
  }

  private async finishCall(
    session: CallSession,
    reason: CallEndReason,
  ): Promise<CallSession> {
    if (session.status === CallSessionStatus.ENDED) {
      return session;
    }
    this.clearRingTimeout(session.id);
    this.stopBillingLoop(session.id);
    const endedCount = await this.database.callSession.updateMany({
      where: {
        id: session.id,
        status: { in: [CallSessionStatus.RINGING, CallSessionStatus.ACTIVE] },
      },
      data: {
        status: CallSessionStatus.ENDED,
        endReason: reason,
        endedAt: new Date(),
      },
    });
    if (endedCount.count === 0) {
      return this.database.callSession.findUniqueOrThrow({
        where: { id: session.id },
      });
    }
    const ended = await this.database.callSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const payload = {
      callId: ended.id,
      conversationId: ended.conversationId,
      reason,
      billedMinutes: ended.billedMinutes,
      pointsCharged: ended.pointsCharged,
    };
    this.emitter?.emitToUser(ended.callerId, "call:ended", payload);
    this.emitter?.emitToUser(ended.calleeId, "call:ended", payload);

    const durationMs =
      (ended.endedAt?.getTime() ?? Date.now()) -
      (ended.startedAt?.getTime() ?? ended.ringingAt.getTime());
    console.info(
      JSON.stringify({
        event: "call_ended",
        callId: ended.id,
        reason,
        billedMinutes: ended.billedMinutes,
        pointsCharged: ended.pointsCharged,
        durationMs,
      }),
    );

    try {
      await this.createCallHistoryMessage(ended, reason);
    } catch (error) {
      console.error("Failed to create call history message", {
        callId: ended.id,
        error,
      });
    }

    return ended;
  }

  private async createCallHistoryMessage(
    ended: CallSession,
    reason: CallEndReason,
  ): Promise<void> {
    const neverStarted = ended.startedAt == null;
    const missed =
      neverStarted &&
      (reason === CallEndReason.TIMEOUT || reason === CallEndReason.REJECT);
    // Chat shows a centered system log (times). Points stay in metadata only.
    let body: string;
    if (missed) {
      body = "Missed video call";
    } else if (neverStarted) {
      body = "Cancelled video call";
    } else if (ended.billedMinutes > 0) {
      body = `Video call · ${ended.billedMinutes} min`;
    } else {
      body = "Video call ended";
    }

    await this.database.$transaction(async (tx) => {
      // One system log per call — skip if already written (double end / race).
      const existing = await tx.message.findFirst({
        where: {
          conversationId: ended.conversationId,
          type: MessageType.SYSTEM,
          metadata: {
            path: ["callId"],
            equals: ended.id,
          },
        },
        select: { id: true },
      });
      if (existing) return;

      const created = await tx.message.create({
        data: {
          conversationId: ended.conversationId,
          senderId: ended.callerId,
          type: MessageType.SYSTEM,
          body,
          metadata: {
            kind: "VIDEO_CALL",
            callId: ended.id,
            endReason: reason,
            billedMinutes: ended.billedMinutes,
            pointsCharged: ended.pointsCharged,
            ringingAt: ended.ringingAt.toISOString(),
            startedAt: ended.startedAt?.toISOString() ?? null,
            endedAt: ended.endedAt?.toISOString() ?? new Date().toISOString(),
          },
        },
        select: { id: true, createdAt: true },
      });
      await tx.conversation.update({
        where: { id: ended.conversationId },
        data: { updatedAt: created.createdAt },
      });
      const eventPayload = {
        messageId: created.id,
        conversationId: ended.conversationId,
        senderId: ended.callerId,
      };
      await tx.outboxEvent.createMany({
        data: [
          {
            eventType: "chat.message.created",
            aggregateType: "message",
            aggregateId: created.id,
            payload: eventPayload,
          },
          {
            eventType: "message.created",
            aggregateType: "message",
            aggregateId: created.id,
            payload: eventPayload,
          },
        ],
      });
    });
  }

  async listCallHistory(
    userId: string,
  ): Promise<{ items: CallHistoryItemView[] }> {
    const sessions = await this.database.callSession.findMany({
      where: {
        status: CallSessionStatus.ENDED,
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      orderBy: { ringingAt: "desc" },
      take: 50,
      select: {
        id: true,
        conversationId: true,
        callerId: true,
        calleeId: true,
        endReason: true,
        ringingAt: true,
        startedAt: true,
        endedAt: true,
        billedMinutes: true,
        caller: { select: { username: true, displayName: true } },
        callee: { select: { username: true, displayName: true } },
      },
    });

    return {
      items: sessions.map((session) => {
        const outgoing = session.callerId === userId;
        const peer = outgoing ? session.callee : session.caller;
        const missed =
          session.startedAt == null &&
          (session.endReason === CallEndReason.TIMEOUT ||
            session.endReason === CallEndReason.REJECT);
        return {
          id: session.id,
          conversationId: session.conversationId,
          peerName: peer.displayName?.trim() || peer.username || "Milox match",
          outgoing,
          missed,
          billedMinutes: session.billedMinutes,
          ringingAt: session.ringingAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async getCallForUser(
    callId: string,
    userId: string,
  ): Promise<CallSessionView> {
    const session = await this.requireParticipant(callId, userId);
    const economy = await ensureAppEconomyConfig(this.database);
    return this.present(session, economy.videoCallPointsPerMinute, userId);
  }

  private present(
    session: CallSession,
    pointsPerMinute: number,
    forUserId: string,
  ): CallSessionView {
    return {
      id: session.id,
      conversationId: session.conversationId,
      matchId: session.matchId,
      callerId: session.callerId,
      calleeId: session.calleeId,
      status: session.status,
      endReason: session.endReason,
      ringingAt: session.ringingAt.toISOString(),
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      billedMinutes: session.billedMinutes,
      pointsCharged: session.pointsCharged,
      pointsPerMinute,
      iceServers: buildIceServers(this.config, forUserId),
    };
  }
}

function mediaUrl(
  mediaId: string | null | undefined,
  config: AppConfig,
): string | null {
  if (!mediaId) return null;
  return `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${mediaId}`;
}
