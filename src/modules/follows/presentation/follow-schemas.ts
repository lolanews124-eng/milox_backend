import { z } from "zod";

export const usernameParamSchema = z.object({
  username: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, ""))
    .pipe(z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/)),
});

export const followIdParamSchema = z.object({
  followId: z.uuid(),
});

export const followPageQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const respondFollowSchema = z
  .object({
    action: z.enum(["accept", "reject"]),
  })
  .strict();
