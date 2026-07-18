import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { ChatService } from "../application/services/chat-service.js";
import {
  chatMediaParamSchema,
  conversationIdParamSchema,
  conversationPageQuerySchema,
  conversationSettingsSchema,
  deleteMessageQuerySchema,
  editMessageSchema,
  idempotencyKeySchema,
  markReadSchema,
  messageIdParamSchema,
  messagePageQuerySchema,
  sendMessageSchema,
} from "./chat-schemas.js";

export class ChatController {
  constructor(private readonly chat: ChatService) {}

  listConversations = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = conversationPageQuerySchema.parse(request.query);
    const page = await this.chat.listConversations(requireUser(request), {
      filter: query.filter,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageSuccess(request, page));
  };

  getConversation = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId } = conversationIdParamSchema.parse(request.params);
    const conversation = await this.chat.getConversation(
      conversationId,
      requireUser(request),
    );
    response.status(200).json(success(request, conversation));
  };

  updateSettings = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId } = conversationIdParamSchema.parse(request.params);
    const settings = conversationSettingsSchema.parse(request.body as unknown);
    const conversation = await this.chat.updateSettings(
      conversationId,
      requireUser(request),
      settings,
    );
    response.status(200).json(success(request, conversation));
  };

  listMessages = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId } = conversationIdParamSchema.parse(request.params);
    const query = messagePageQuerySchema.parse(request.query);
    const page = await this.chat.listMessages(
      conversationId,
      requireUser(request),
      {
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
      },
    );
    response.status(200).json(pageSuccess(request, page));
  };

  sendMessage = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId } = conversationIdParamSchema.parse(request.params);
    const input = sendMessageSchema.parse(request.body as unknown);
    const idempotencyKey = idempotencyKeySchema.parse(
      request.header("Idempotency-Key"),
    );
    const result = await this.chat.sendMessage(
      conversationId,
      requireUser(request),
      input,
      idempotencyKey,
    );
    response
      .status(201)
      .set("Idempotency-Replayed", String(result.replayed))
      .json(success(request, result.item));
  };

  markRead = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId } = conversationIdParamSchema.parse(request.params);
    const { lastReadMessageId } = markReadSchema.parse(
      request.body as unknown,
    );
    await this.chat.markRead(
      conversationId,
      requireUser(request),
      lastReadMessageId,
    );
    response.status(204).send();
  };

  deleteMessage = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { messageId } = messageIdParamSchema.parse(request.params);
    const { scope } = deleteMessageQuerySchema.parse(request.query);
    await this.chat.deleteMessage(messageId, requireUser(request), scope);
    response.status(204).send();
  };

  editMessage = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { messageId } = messageIdParamSchema.parse(request.params);
    const { body } = editMessageSchema.parse(request.body as unknown);
    const message = await this.chat.editMessage(
      messageId,
      requireUser(request),
      body,
    );
    response.status(200).json(success(request, message));
  };

  serveMedia = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId, mediaId } = chatMediaParamSchema.parse(
      request.params,
    );
    const media = await this.chat.resolveChatMedia(
      conversationId,
      mediaId,
      requireUser(request),
    );
    response.type(media.mimeType);
    response.set("Cache-Control", "private, max-age=3600");
    if (media.checksum) response.set("ETag", `"${media.checksum}"`);
    response.sendFile(media.absolutePath);
  };
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}

function success(request: Request, data: object) {
  return {
    success: true,
    data,
    meta: { requestId: request.requestId },
  };
}

function pageSuccess(
  request: Request,
  page: { items: object[]; nextCursor: string | null; hasMore: boolean },
) {
  return {
    success: true,
    data: { items: page.items },
    meta: {
      requestId: request.requestId,
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    },
  };
}
