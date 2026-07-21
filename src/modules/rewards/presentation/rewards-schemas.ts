import { z } from "zod";

export const referralCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4)
    .max(16)
    .regex(/^[a-zA-Z0-9]+$/),
});

export const walletTransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const claimRewardedAdSchema = z.object({
  claimId: z.uuid(),
});
