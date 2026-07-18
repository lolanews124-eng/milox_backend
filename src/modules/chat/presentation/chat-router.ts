import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { ChatController } from "./chat-controller.js";

export interface ChatRouters {
  conversations: Router;
  messages: Router;
}

export function createChatRouters(
  controller: ChatController,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): ChatRouters {
  const conversations = Router();
  const messages = Router();
  const sendLimit = createRateLimit(120, 10 * 60 * 1000);
  const actionLimit = createRateLimit(240, 10 * 60 * 1000);

  conversations.use(authenticate);
  conversations.get("/", asyncHandler(controller.listConversations));
  conversations.get(
    "/:conversationId/media/:mediaId",
    asyncHandler(controller.serveMedia),
  );
  conversations.get(
    "/:conversationId/messages",
    asyncHandler(controller.listMessages),
  );
  conversations.post(
    "/:conversationId/messages",
    requireVerified,
    sendLimit,
    asyncHandler(controller.sendMessage),
  );
  conversations.post(
    "/:conversationId/read",
    actionLimit,
    asyncHandler(controller.markRead),
  );
  conversations.patch(
    "/:conversationId/settings",
    actionLimit,
    asyncHandler(controller.updateSettings),
  );
  conversations.get(
    "/:conversationId",
    asyncHandler(controller.getConversation),
  );

  messages.delete(
    "/:messageId",
    authenticate,
    actionLimit,
    asyncHandler(controller.deleteMessage),
  );
  messages.patch(
    "/:messageId",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.editMessage),
  );
  return { conversations, messages };
}
