import { z } from "zod";

const hmTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected HH:mm");

const scheduleWindowSchema = z.object({
  enabled: z.boolean().optional(),
  start: hmTimeSchema.optional(),
  end: hmTimeSchema.optional(),
  accountQuota: z.number().int().min(0).max(200).optional(),
  maxJobs: z.number().int().min(0).max(200).optional(),
});

export const previewCandidatesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1_000).optional(),
  /** When true, persists an auditable BotCandidateBatch (still does not create bots). */
  persist: z.boolean().optional().default(false),
});

export const batchIdParamSchema = z.object({
  batchId: z.string().uuid(),
});

export const botIdParamSchema = z.object({
  botId: z.string().uuid(),
});

export const lockSelectionSchema = z.object({
  selectedUserIds: z.array(z.string().uuid()).max(200),
});

export const provisionSchema = z.object({
  dryRun: z.boolean().default(true),
  confirm: z.boolean().optional().default(false),
  /** Required exact phrase for live writes: PROVISION */
  confirmPhrase: z.string().trim().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const listBotsQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const listPagedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
  botAccountId: z.string().uuid().optional(),
  activityType: z
    .enum(["LIKE_POST", "COMMENT_POST", "FOLLOW_USER", "VIEW_POST", "VIEW_STORY", "VIEW_REEL"])
    .optional(),
  status: z
    .enum([
      "PENDING",
      "PROCESSING",
      "PROCESSED",
      "FAILED",
      "CANCELLED",
      "SKIPPED",
    ])
    .optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
});

export const jobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

export const previewJobsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const updateBotStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
});

/** Per-bot activity permissions and daily caps (UTC). Missing keys keep prior values. */
export const updateBotPermissionsSchema = z
  .object({
    likesEnabled: z.boolean().optional(),
    commentsEnabled: z.boolean().optional(),
    followsEnabled: z.boolean().optional(),
    viewsEnabled: z.literal(false).optional(),
    maxLikesPerDay: z.number().int().min(0).max(500).optional(),
    maxCommentsPerDay: z.number().int().min(0).max(200).optional(),
    maxFollowsPerDay: z.number().int().min(0).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one permission field is required",
  });

export const updateBotSchema = z
  .object({
    status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
    permissions: updateBotPermissionsSchema.optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.permissions !== undefined,
    { message: "Provide status and/or permissions" },
  );

export const updateBotSettingsSchema = z
  .object({
    killSwitch: z.boolean().optional(),
    globalPause: z.boolean().optional(),
    maxConcurrency: z.number().int().min(1).max(10).optional(),
    activityLimits: z
      .object({
        likesEnabled: z.boolean().optional(),
        commentsEnabled: z.boolean().optional(),
        followsEnabled: z.boolean().optional(),
        viewsEnabled: z.boolean().optional(),
        plannerIntervalMs: z.number().int().min(15_000).max(3_600_000).optional(),
        maxJobsPerTick: z.number().int().min(1).max(50).optional(),
        maxGlobalLikesPerHour: z.number().int().min(0).max(1_000).optional(),
        maxGlobalCommentsPerHour: z.number().int().min(0).max(500).optional(),
        maxGlobalFollowsPerHour: z.number().int().min(0).max(500).optional(),
        excludePrivateAccounts: z.boolean().optional(),
        excludeAutomatedTargets: z.boolean().optional(),
        scheduling: z
          .object({
            enabled: z.boolean().optional(),
            timezone: z.string().trim().min(1).max(64).optional(),
            likesEnabled: z.boolean().optional(),
            commentsEnabled: z.boolean().optional(),
            followsEnabled: z.boolean().optional(),
            defaultMaxLikesPerDay: z.number().int().min(0).max(500).optional(),
            defaultMaxCommentsPerDay: z.number().int().min(0).max(500).optional(),
            defaultMaxFollowsPerDay: z.number().int().min(0).max(500).optional(),
            missedWindowPolicy: z.literal("skip").optional(),
            windows: z
              .object({
                morning: scheduleWindowSchema.optional(),
                afternoon: scheduleWindowSchema.optional(),
                evening: scheduleWindowSchema.optional(),
                night: scheduleWindowSchema.optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    commentTemplates: z
      .array(z.string().trim().min(1).max(280))
      .max(100)
      .optional(),
    usernameSuffix: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[a-zA-Z0-9_]+$/)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one settings field is required",
  });
