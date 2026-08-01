import type { BroadcastOfficialMessageInput } from "../official-chat-types.js";
import type { PrismaOfficialChatRepository } from "../infrastructure/prisma-official-chat-repository.js";

export interface OfficialBroadcastResult {
  sent: number;
  failed: number;
}

export class OfficialChatService {
  constructor(private readonly repository: PrismaOfficialChatRepository) {}

  broadcast(
    input: BroadcastOfficialMessageInput,
  ): Promise<OfficialBroadcastResult> {
    return this.repository.broadcastToAllUsers(input);
  }
}
