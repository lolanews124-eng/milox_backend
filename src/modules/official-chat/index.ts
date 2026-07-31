import type { PrismaClient } from "@prisma/client";

import { ensureMiloxOfficialUser } from "../../infrastructure/milox-official-user.js";
import { OfficialChatService } from "./application/official-chat-service.js";
import {
  PrismaOfficialChatRepository,
  type SignupOfficialChatWriter,
} from "./infrastructure/prisma-official-chat-repository.js";

export interface OfficialChatModule {
  service: OfficialChatService;
  signupWriter: SignupOfficialChatWriter;
}

export async function createOfficialChatModule(
  database: PrismaClient,
): Promise<OfficialChatModule> {
  const official = await ensureMiloxOfficialUser(database);
  const repository = new PrismaOfficialChatRepository(database, official);
  return {
    service: new OfficialChatService(repository),
    signupWriter: repository,
  };
}
