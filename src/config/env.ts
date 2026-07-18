import { z } from "zod";

const envSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().url(),
  ADMIN_ORIGIN: z.string().url(),
  /** Comma-separated extra browser origins allowed by CORS (e.g. production domains). */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url())),
  API_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  UPLOAD_ROOT: z.string().default("../../uploads"),
  JWT_ACCESS_SECRET: z.string().min(32),
  CURSOR_SIGNING_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_ISSUER: z.string().default("milox-api"),
  JWT_AUDIENCE: z.string().default("milox-clients"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(24),
  /** When true, signup marks email verified immediately (local/dev flows). */
  AUTO_VERIFY_EMAIL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PASSWORD_RESET_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_FROM: z.string().default("no-reply@localhost"),
  EMAIL_WORKER_POLL_MS: z.coerce.number().int().positive().default(5_000),
    FEED_SCORE_POLL_MS: z.coerce.number().int().positive().default(300_000),
    INTEREST_DAILY_LIMIT: z.coerce.number().int().positive().max(500).default(20),
    CHAT_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
    NOTIFICATION_OUTBOX_POLL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(500),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      !environment.CURSOR_SIGNING_SECRET
    ) {
      context.addIssue({
        code: "custom",
        path: ["CURSOR_SIGNING_SECRET"],
        message: "A dedicated cursor signing secret is required in production",
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= envSchema.parse(process.env);
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = undefined;
}

export function getAllowedOrigins(config: AppConfig): string[] {
  return [...new Set([config.WEB_ORIGIN, config.ADMIN_ORIGIN, ...config.CORS_ORIGINS])];
}
