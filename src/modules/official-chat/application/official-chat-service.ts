import type { BroadcastOfficialMessageInput } from "../official-chat-types.js";
import type { PrismaOfficialChatRepository } from "../infrastructure/prisma-official-chat-repository.js";

export class OfficialChatService {
  constructor(private readonly repository: PrismaOfficialChatRepository) {}

  broadcast(input: BroadcastOfficialMessageInput): Promise<{ sent: number }> {
    return this.repository.broadcastToAllUsers(input);
  }
}
