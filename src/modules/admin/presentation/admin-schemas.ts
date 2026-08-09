import { AdPlacement, CmsPageStatus, EmailJobStatus, EmailJobType, MatchStatus, MediaKind, MediaVisibility, OutboxStatus, ReportStatus, SubscriptionStatus, UserRole, UserStatus, WalletTransactionType } from "@prisma/client";
import { PremiumTier } from "@prisma/client";
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
  emailVerified: z
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

export const adminCommentQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  postId: z.uuid().optional(),
  hidden: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  bucket: z.enum(["all", "reported", "hidden", "removed", "replies"]).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  ...offsetPageSchema,
});

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

export const premiumBillingCycleSchema = z.enum([
  "MONTHLY",
  "YEARLY",
  "ONE_TIME",
]);

export const premiumPlanPriceSchema = z
  .object({
    billingCycle: premiumBillingCycleSchema,
    priceCents: z.coerce.number().int().min(0),
    durationDays: z.coerce.number().int().min(1).max(36500),
    isActive: z.boolean().optional(),
  })
  .strict();

export const createPremiumPlanSchema = z
  .object({
    code: z.string().trim().min(2).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    tier: z.nativeEnum(PremiumTier).default("PLUS"),
    sortOrder: z.coerce.number().int().min(0).max(100).default(0),
    badgeLabel: z.string().trim().min(1).max(40).default("Premium"),
    priceCents: z.coerce.number().int().min(0),
    currency: z.string().trim().length(3).default("USD"),
    durationDays: z.coerce.number().int().min(1).max(3650),
    adsFree: z.boolean().default(true),
    houseAdsFree: z.boolean().default(false),
    profileViews: z.boolean().default(true),
    discoverBoost: z.coerce.number().int().min(0).max(10).default(1),
    grantVerifiedBadge: z.boolean().default(false),
    dailyInterestLimit: z.coerce.number().int().min(1).max(9999).default(30),
    interstitialAdsFree: z.boolean().default(true),
    directMessageEnabled: z.boolean().default(false),
    prices: z.array(premiumPlanPriceSchema).length(3).optional(),
  })
  .strict();

export const updatePremiumPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    tier: z.nativeEnum(PremiumTier).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100).optional(),
    badgeLabel: z.string().trim().min(1).max(40).optional(),
    priceCents: z.coerce.number().int().min(0).optional(),
    durationDays: z.coerce.number().int().min(1).max(3650).optional(),
    isActive: z.boolean().optional(),
    adsFree: z.boolean().optional(),
    houseAdsFree: z.boolean().optional(),
    profileViews: z.boolean().optional(),
    discoverBoost: z.coerce.number().int().min(0).max(10).optional(),
    grantVerifiedBadge: z.boolean().optional(),
    dailyInterestLimit: z.coerce.number().int().min(1).max(9999).optional(),
    interstitialAdsFree: z.boolean().optional(),
    directMessageEnabled: z.boolean().optional(),
    prices: z.array(premiumPlanPriceSchema).min(1).max(3).optional(),
  })
  .strict();

export const adminPlanIdParamSchema = z.object({
  planId: z.uuid(),
});

export const adminSubscriptionQuerySchema = z.object({
  status: z.enum(SubscriptionStatus).optional(),
  userId: z.uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  ...offsetPageSchema,
});

export const grantSubscriptionSchema = z
  .object({
    userId: z.uuid(),
    planId: z.uuid(),
    billingCycle: premiumBillingCycleSchema.default("MONTHLY"),
  })
  .strict();

export const adminSubscriptionIdParamSchema = z.object({
  subscriptionId: z.uuid(),
});

export const adminAdQuerySchema = z.object({
  placement: z.enum(AdPlacement).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  ...offsetPageSchema,
});

export const createAdSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(500).optional(),
    imageUrl: z.string().trim().url().max(512).optional(),
    targetUrl: z.string().trim().url().max(512).optional(),
    ctaLabel: z.string().trim().min(1).max(40).optional(),
    placement: z.enum(AdPlacement),
    priority: z.coerce.number().int().min(0).max(10_000).optional(),
    insertEvery: z.coerce.number().int().min(1).max(100).nullable().optional(),
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
    ctaLabel: z.string().trim().min(1).max(40).nullable().optional(),
    placement: z.enum(AdPlacement).optional(),
    priority: z.coerce.number().int().min(0).max(10_000).optional(),
    insertEvery: z.coerce.number().int().min(1).max(100).nullable().optional(),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const adminAdPlacementParamSchema = z.object({
  placement: z.enum(AdPlacement),
});

export const updateAdPlacementConfigSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(255).nullable().optional(),
    isEnabled: z.boolean().optional(),
    insertEvery: z.coerce.number().int().min(1).max(100).optional(),
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

export const adminBlogQuerySchema = z.object({
  status: z.enum(CmsPageStatus).optional(),
  ...offsetPageSchema,
});

export const createBlogPostSchema = z
  .object({
    slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(200),
    excerpt: z.string().trim().max(500).nullable().optional(),
    bodyMarkdown: z.string().trim().min(1).max(100_000),
    coverImageUrl: z.string().trim().url().max(2048).nullable().optional(),
    metaDescription: z.string().trim().max(320).nullable().optional(),
    status: z.enum(CmsPageStatus).optional(),
  })
  .strict();

export const updateBlogPostSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    title: z.string().trim().min(1).max(200).optional(),
    excerpt: z.string().trim().max(500).nullable().optional(),
    bodyMarkdown: z.string().trim().min(1).max(100_000).optional(),
    coverImageUrl: z.string().trim().url().max(2048).nullable().optional(),
    metaDescription: z.string().trim().max(320).nullable().optional(),
    status: z.enum(CmsPageStatus).optional(),
  })
  .strict();

export const adminBlogPostIdParamSchema = z.object({
  postId: z.uuid(),
});

export const adminMatchQuerySchema = z.object({
  status: z.enum(MatchStatus).optional(),
  userId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...offsetPageSchema,
});

export const adminReferralQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  referrerUserId: z.uuid().optional(),
  ...offsetPageSchema,
});

export const adminReferralCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(16)
    .transform((value) => value.toUpperCase()),
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
    /** Soft-delete and remove the binary from UPLOAD_ROOT (cannot restore file). */
    purgeStorage: z.boolean().optional().default(false),
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

const officialMessageButtonSchema = z
  .object({
    label: z.string().trim().min(1).max(64),
    actionType: z.enum(["OPEN_URL", "NAVIGATE"]),
    url: z.string().trim().url().max(500).optional(),
    route: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((value, context) => {
    if (value.actionType === "OPEN_URL" && !value.url) {
      context.addIssue({
        code: "custom",
        message: "url is required for OPEN_URL buttons",
        path: ["url"],
      });
    }
    if (value.actionType === "NAVIGATE" && !value.route) {
      context.addIssue({
        code: "custom",
        message: "route is required for NAVIGATE buttons",
        path: ["route"],
      });
    }
  });

export const broadcastOfficialMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  buttons: z.array(officialMessageButtonSchema).max(4).optional(),
  mediaId: z.uuid().optional(),
});

export const officialBroadcastJobIdParamSchema = z.object({
  jobId: z.uuid(),
});

export const adminWalletLookupQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export const adminWalletTransactionQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  userId: z.uuid().optional(),
  type: z.enum(WalletTransactionType).optional(),
  ...offsetPageSchema,
});

export const adminAdjustWalletSchema = z
  .object({
    userId: z.uuid().optional(),
    username: z.string().trim().min(1).max(32).optional(),
    points: z.coerce.number().int().min(1).max(1_000_000),
    direction: z.enum(["credit", "debit"]),
    note: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.userId || value.username), {
    message: "userId or username is required",
  });

export const adminPointPurchaseRateIdParamSchema = z.object({
  rateId: z.uuid(),
});

export const createPointPurchaseRateSchema = z
  .object({
    currency: z.string().trim().length(3),
    amountMinor: z.coerce.number().int().min(1).max(100_000_000),
    points: z.coerce.number().int().min(1).max(10_000_000),
    label: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const updatePointPurchaseRateSchema = z
  .object({
    currency: z.string().trim().length(3).optional(),
    amountMinor: z.coerce.number().int().min(1).max(100_000_000).optional(),
    points: z.coerce.number().int().min(1).max(10_000_000).optional(),
    label: z.string().trim().min(1).max(120).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .strict();
