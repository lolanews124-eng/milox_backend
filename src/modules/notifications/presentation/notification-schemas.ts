import { z } from "zod";

export const notificationPageQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100).optional(),
    all: z.boolean().optional(),
  })
  .strict()
  .default({});
