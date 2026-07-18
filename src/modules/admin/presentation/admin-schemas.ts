import { ReportStatus, UserStatus } from "@prisma/client";
import { z } from "zod";

export const adminUserIdParamSchema = z.object({
  userId: z.uuid(),
});

export const adminReportIdParamSchema = z.object({
  reportId: z.uuid(),
});

const offsetPageSchema = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const adminUserQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(UserStatus).optional(),
  ...offsetPageSchema,
});

export const adminReportQuerySchema = z.object({
  status: z.enum(ReportStatus).optional(),
  ...offsetPageSchema,
});

export const changeUserStatusSchema = z
  .object({
    status: z.enum([
      UserStatus.ACTIVE,
      UserStatus.SUSPENDED,
      UserStatus.BANNED,
    ]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const resolveReportSchema = z
  .object({
    resolution: z.enum(["resolved", "dismissed"]),
    actionCode: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .optional(),
    note: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
