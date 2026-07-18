import { ReportTargetType } from "@prisma/client";
import { z } from "zod";

export const REPORT_REASON_CODES = [
  "SPAM",
  "HARASSMENT",
  "NUDITY",
  "SCAM",
  "HATE_SPEECH",
  "UNDERAGE",
  "OTHER",
] as const;

export const usernameParamSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
});

export const blockPageQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createReportSchema = z
  .object({
    targetType: z.enum([
      ReportTargetType.USER,
      ReportTargetType.POST,
      ReportTargetType.COMMENT,
      ReportTargetType.MESSAGE,
    ]),
    reportedUserId: z.uuid().nullable().optional(),
    postId: z.uuid().nullable().optional(),
    commentId: z.uuid().nullable().optional(),
    messageId: z.uuid().nullable().optional(),
    reasonCode: z.enum(REPORT_REASON_CODES),
    details: z.string().trim().min(1).max(1_000).nullable().optional(),
  })
  .strict();
