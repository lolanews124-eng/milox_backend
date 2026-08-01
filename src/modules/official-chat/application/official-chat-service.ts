import type { BroadcastOfficialMessageInput } from "../official-chat-types.js";
import type { PrismaOfficialChatRepository } from "../infrastructure/prisma-official-chat-repository.js";

export interface OfficialBroadcastResult {
  sent: number;
  failed: number;
  total: number;
}

export class OfficialChatService {
  constructor(private readonly repository: PrismaOfficialChatRepository) {}

  countBroadcastRecipients(): Promise<number> {
    return this.repository.countBroadcastRecipients();
  }

  broadcast(
    input: BroadcastOfficialMessageInput,
  ): Promise<OfficialBroadcastResult> {
    return this.repository.broadcastToAllUsers(input);
  }
}
