import { MessageType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaOfficialChatRepository } from "../src/modules/official-chat/infrastructure/prisma-official-chat-repository.js";

describe("PrismaOfficialChatRepository.broadcastToAllUsers", () => {
  it("continues delivering when one user fails", async () => {
    const wakeOutbox = vi.fn();
    const transaction = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({ id: "conv-1" }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
      },
      conversationMember: {
        upsert: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
      },
      message: {
        create: vi.fn().mockResolvedValue({ id: "msg-1" }),
      },
      outboxEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    let call = 0;
    const database = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "user-bad" }, { id: "user-good" }])
          .mockResolvedValueOnce([]),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => {
        call += 1;
        if (call === 1) {
          throw new Error("member row missing");
        }
        return callback(transaction);
      }),
    };

    const repository = new PrismaOfficialChatRepository(
      database as never,
      {
        id: "official-1",
        username: "milox",
        displayName: "Milox Official",
      },
      wakeOutbox,
    );

    const result = await repository.broadcastToAllUsers({
      body: "Hello everyone",
    });

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderId: "official-1",
        type: MessageType.SYSTEM,
        body: "Hello everyone",
      }),
      select: { id: true },
    });
    expect(wakeOutbox).toHaveBeenCalledOnce();
  });
});
