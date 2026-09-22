import { ageRangeSchema, countrySchema } from "../../../shared/contracts/profile-fields.js";
import { z } from "zod";

const nullableTrimmed = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]);

/** Accept handle, @handle, or full Instagram URL → bare handle. */
export function normalizeInstagramHandle(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  value = value.replace(/^@+/, "");

  const fromUrl = value.match(
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/i,
  );
  if (fromUrl?.[1]) {
    value = fromUrl[1];
  } else {
    value = value.split(/[/?#]/)[0] ?? value;
  }

  value = value.replace(/^@+/, "").trim();
  if (!value) return null;
  if (!/^[a-zA-Z0-9._]{1,64}$/.test(value)) {
    throw new Error("INVALID_INSTAGRAM_HANDLE");
  }
  return value;
}

/** Accept bare domains / www / https → absolute https URL. */
export function normalizeWebsiteUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value.replace(/^\/\//, "")}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("INVALID_WEBSITE_URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("INVALID_WEBSITE_URL");
  }

  const href = parsed.toString();
  if (href.length > 255) {
    throw new Error("WEBSITE_URL_TOO_LONG");
  }
  return href;
}

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});

export const profileViewsQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
      .union([
        z
          .string()
          .trim()
          .max(255)
          .transform((value, ctx) => {
            try {
              return normalizeWebsiteUrl(value);
            } catch {
              ctx.addIssue({
                code: "custom",
                message: "Enter a valid website link (e.g. https://example.com)",
              });
              return z.NEVER;
            }
          }),
        z.null(),
      ])
      .optional(),
    instagramHandle: z
      .union([
        z
          .string()
          .trim()
          .max(255)
          .transform((value, ctx) => {
            try {
              return normalizeInstagramHandle(value);
            } catch {
              ctx.addIssue({
                code: "custom",
                message:
                  "Enter an Instagram username (e.g. jane_doe) or profile link",
              });
              return z.NEVER;
            }
          }),
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
