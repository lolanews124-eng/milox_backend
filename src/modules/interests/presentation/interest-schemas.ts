import { InterestStatus } from "@prisma/client";
import { z } from "zod";

export const interestIdParamSchema = z.object({
  interestId: z.uuid(),
});

export const matchIdParamSchema = z.object({
  matchId: z.uuid(),
});

export const idempotencyKeySchema = z.uuid();

export const sendInterestSchema = z
  .object({
    recipientId: z.uuid(),
    message: z.string().max(280).optional(),
  })
  .strict();

export const interestPageQuerySchema = z.object({
  status: z.enum(InterestStatus).optional(),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const matchPageQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
