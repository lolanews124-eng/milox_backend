import { z } from "zod";

export const postIdParamSchema = z.object({
  postId: z.uuid(),
});

export const commentIdParamSchema = z.object({
  commentId: z.uuid(),
});

export const commentPageQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createCommentSchema = z
  .object({
    body: z.string().max(1_000),
    parentId: z.uuid().nullable().optional(),
  })
  .strict();
