import { AdPlacement, CmsPageStatus, EmailJobStatus, EmailJobType, MatchStatus, MediaKind, MediaVisibility, OutboxStatus, ReportStatus, SubscriptionStatus, UserRole, UserStatus } from "@prisma/client";
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
  verified: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  online: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  reported: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  ...offsetPageSchema,
});

export const adminReportQuerySchema = z.object({
  status: z.enum(ReportStatus).optional(),
  ...offsetPageSchema,
});

export const adminPostQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  hidden: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  bucket: z.enum(["all", "reported", "pending", "hidden", "removed"]).optional(),
  mediaKind: z.enum(["image", "video", "text", "audio"]).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  ...offsetPageSchema,
});

export const adminPostIdParamSchema = z.object({
  postId: z.uuid(),
});

export const adminStoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  bucket: z.enum(["all", "active", "expired", "removed"]).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  ...offsetPageSchema,
});

export const adminStoryIdParamSchema = z.object({
  storyId: z.uuid(),
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

export const updatePostVisibilitySchema = z
  .object({
    isHidden: z.boolean(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const deletePostSchema = z
  .object({
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const deleteStorySchema = deletePostSchema;

export const adminCommentQuerySchema = adminPostQuerySchema;

export const adminCommentIdParamSchema = z.object({
  commentId: z.uuid(),
});

export const adminAuditLogQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  resourceType: z.string().trim().min(1).max(64).optional(),
  ...offsetPageSchema,
});

export const adminInterestTagIdParamSchema = z.object({
  tagId: z.uuid(),
});

export const createInterestTagSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  })
  .strict();

export const updateInterestTagSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const changeStaffRoleSchema = z
  .object({
    role: z.enum([
      UserRole.USER,
      UserRole.MODERATOR,
      UserRole.ADMIN,
    ]),
  })
  .strict();

export const setVerifiedBadgeSchema = z
  .object({
    isVerifiedBadge: z.boolean(),
  })
  .strict();

export const createPremiumPlanSchema = z
  .object({
    code: z.string().trim().min(2).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    priceCents: z.coerce.number().int().min(0),
    currency: z.string().trim().length(3).default("USD"),
    durationDays: z.coerce.number().int().min(1).max(3650),
  })
  .strict();

export const updatePremiumPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    priceCents: z.coerce.number().int().min(0).optional(),
    durationDays: z.coerce.number().int().min(1).max(3650).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const adminPlanIdParamSchema = z.object({
  planId: z.uuid(),
});

export const adminSubscriptionQuerySchema = z.object({
  status: z.enum(SubscriptionStatus).optional(),
  userId: z.uuid().optional(),
  ...offsetPageSchema,
});

export const grantSubscriptionSchema = z
  .object({
    userId: z.uuid(),
    planId: z.uuid(),
  })
  .strict();

export const adminSubscriptionIdParamSchema = z.object({
  subscriptionId: z.uuid(),
});

export const createAdSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(500).optional(),
    imageUrl: z.string().trim().url().max(512).optional(),
    targetUrl: z.string().trim().url().max(512).optional(),
    placement: z.enum(AdPlacement),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
  })
  .strict();

export const updateAdSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().max(500).nullable().optional(),
    imageUrl: z.string().trim().url().max(512).nullable().optional(),
    targetUrl: z.string().trim().url().max(512).nullable().optional(),
    placement: z.enum(AdPlacement).optional(),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const adminAdIdParamSchema = z.object({
  adId: z.uuid(),
});

export const createCmsPageSchema = z
  .object({
    slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(200),
    bodyMarkdown: z.string().trim().min(1).max(50_000),
    status: z.enum(CmsPageStatus).optional(),
  })
  .strict();

export const updateCmsPageSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    bodyMarkdown: z.string().trim().min(1).max(50_000).optional(),
    status: z.enum(CmsPageStatus).optional(),
  })
  .strict();

export const adminCmsPageIdParamSchema = z.object({
  pageId: z.uuid(),
});

export const adminMatchQuerySchema = z.object({
  status: z.enum(MatchStatus).optional(),
  userId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...offsetPageSchema,
});

export const adminConversationQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  bucket: z.enum(["all", "active", "closed", "reported"]).optional(),
  ...offsetPageSchema,
});

export const adminConversationIdParamSchema = z.object({
  conversationId: z.uuid(),
});

export const adminMessageIdParamSchema = z.object({
  messageId: z.uuid(),
});

export const deleteAdminMessageSchema = deletePostSchema;

export const adminMediaQuerySchema = z.object({
  kind: z.enum(MediaKind).optional(),
  visibility: z.enum(MediaVisibility).optional(),
  ownerUserId: z.uuid().optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...offsetPageSchema,
});

export const adminMediaIdParamSchema = z.object({
  mediaId: z.uuid(),
});

export const updateMediaSchema = z
  .object({
    deleted: z.boolean(),
  })
  .strict();

export const adminOutboxQuerySchema = z.object({
  status: z.enum(OutboxStatus).optional(),
  eventType: z.string().trim().min(1).max(100).optional(),
  aggregateType: z.string().trim().min(1).max(64).optional(),
  ...offsetPageSchema,
});

export const adminOutboxEventIdParamSchema = z.object({
  eventId: z.uuid(),
});

export const adminEmailJobQuerySchema = z.object({
  status: z.enum(EmailJobStatus).optional(),
  type: z.enum(EmailJobType).optional(),
  ...offsetPageSchema,
});

export const adminEmailJobIdParamSchema = z.object({
  jobId: z.uuid(),
});

export const adminHashtagQuerySchema = z.object({
  q: z.string().trim().min(1).max(64).optional(),
  ...offsetPageSchema,
});

export const adminHashtagIdParamSchema = z.object({
  hashtagId: z.uuid(),
});
