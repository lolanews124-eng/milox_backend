import { z } from "zod";

export const postIdParamSchema = z.object({
  postId: z.uuid(),
});

export const usernameParamSchema = z.object({
  username: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, ""))
    .pipe(z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/)),
});

export const postPageQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const hashtagParamSchema = z.object({
  tag: z
    .string()
    .trim()
    .transform((value) => value.replace(/^#/, "").toLowerCase())
    .pipe(z.string().min(2).max(30).regex(/^[\p{L}\p{N}_]+$/u)),
});

export const trendingHashtagsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const hashtagSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const idempotencyKeySchema = z.uuid();

export const createPostSchema = z
  .object({
    body: z.string().max(2_000).optional(),
    mediaIds: z.array(z.uuid()).max(10).default([]),
  })
  .strict();

export const updatePostSchema = z
  .object({
    body: z.union([z.string().max(2_000), z.null()]),
  })
  .strict();

export const reportPostSchema = z
  .object({
    reasonCode: z.enum([
      "SPAM",
      "HARASSMENT",
      "NUDITY",
      "SCAM",
      "HATE_SPEECH",
      "UNDERAGE",
      "OTHER",
    ]),
    details: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
