import { ageRangeSchema, countrySchema } from "@milox/contracts";
import { z } from "zod";

const nullableTrimmed = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]);

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});

export const usernameParamSchema = z.object({
  username: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, ""))
    .pipe(z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/)),
});

export const updateProfileSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/)
      .optional(),
    displayName: nullableTrimmed(80).optional(),
    bio: nullableTrimmed(500).optional(),
    ageRange: ageRangeSchema.optional(),
    country: countrySchema.optional(),
    relationshipGoal: z
      .enum([
        "FRIENDSHIP",
        "DATING",
        "LONG_TERM",
        "MARRIAGE",
        "CASUAL",
        "UNSURE",
      ])
      .nullable()
      .optional(),
    websiteUrl: z
      .union([z.string().trim().url().max(255), z.null()])
      .optional(),
    instagramHandle: z
      .union([
        z
          .string()
          .trim()
          .max(64)
          .regex(/^@?[a-zA-Z0-9._]+$/)
          .transform((value) => value.replace(/^@/, "")),
        z.null(),
      ])
      .optional(),
    profilePhotoMediaId: z.string().uuid().nullable().optional(),
    coverPhotoMediaId: z.string().uuid().nullable().optional(),
    interestSlugs: z
      .array(z.string().trim().min(1).max(64))
      .max(10)
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one profile field is required",
  });

export const privacySettingsSchema = z
  .object({
    isPrivateAccount: z.boolean().optional(),
    hideAge: z.boolean().optional(),
    hideCountry: z.boolean().optional(),
    hideLastSeen: z.boolean().optional(),
    hideOnline: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one privacy setting is required",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(10).max(128),
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ["newPassword"],
    message: "New password must be different",
  });
