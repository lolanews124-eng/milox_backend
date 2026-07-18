import { z } from "zod";

export const conversationIdParamSchema = z.object({
  conversationId: z.uuid(),
});

export const messageIdParamSchema = z.object({
  messageId: z.uuid(),
});

export const chatMediaParamSchema = z.object({
  conversationId: z.uuid(),
  mediaId: z.uuid(),
});

export const idempotencyKeySchema = z.uuid();

export const conversationPageQuerySchema = z.object({
  filter: z.enum(["all", "archived", "pinned"]).default("all"),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const messagePageQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const conversationSettingsSchema = z
  .object({
    isMuted: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    type: z.enum(["TEXT", "IMAGE"]),
    body: z.union([z.string().max(4_000), z.null()]).optional(),
    mediaId: z.union([z.uuid(), z.null()]).optional(),
    replyToId: z.union([z.uuid(), z.null()]).optional(),
  })
  .strict();

export const markReadSchema = z
  .object({
    lastReadMessageId: z.uuid(),
  })
  .strict();

export const deleteMessageQuerySchema = z.object({
  scope: z.enum(["me", "everyone"]).default("me"),
});

export const editMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();
