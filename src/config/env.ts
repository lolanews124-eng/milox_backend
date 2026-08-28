import { z } from "zod";

const envSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().url(),
  /** Public website URL used in shareable links (referrals, emails). */
  PUBLIC_WEB_ORIGIN: z.string().url().default("https://milox.in"),
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
    SUBSCRIPTION_EXPIRY_POLL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300_000),
    INTEREST_DAILY_LIMIT: z.coerce.number().int().positive().max(500).default(30),
    /** Free-tier users send this many interests per day at no point cost. */
    FREE_DAILY_INTEREST_GRANTS: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(10),
    WALLET_WELCOME_BONUS: z.coerce.number().int().nonnegative().default(500),
    REFERRAL_REWARD_POINTS: z.coerce.number().int().nonnegative().default(100),
    POST_REWARD_POINTS: z.coerce.number().int().nonnegative().default(5),
    /** Minimum seconds between standard posts from the same user. */
    POST_COOLDOWN_SECONDS: z.coerce.number().int().positive().max(600).default(45),
    /** Max standard posts allowed inside the burst window. */
    POST_BURST_LIMIT: z.coerce.number().int().positive().max(20).default(3),
    POST_BURST_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(3600)
      .default(600),
    /** Max standard posts per rolling hour (service-level; router limit is a backstop). */
    POST_HOURLY_LIMIT: z.coerce.number().int().positive().max(60).default(12),
    /** Block reposting the same text within this window (seconds). */
    POST_DUPLICATE_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(86400)
      .default(3600),
    INTEREST_SEND_COST: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(40)
      .transform((value) => (value === 10 ? 40 : value)),
    REWARDED_AD_POINTS: z.coerce.number().int().positive().max(500).default(20),
    REWARDED_AD_DAILY_LIMIT: z.coerce.number().int().positive().max(50).default(10),
    PAYPAL_CLIENT_ID: z.string().default(""),
    PAYPAL_CLIENT_SECRET: z.string().default(""),
    PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    PAYPAL_WEBHOOK_ID: z.string().default(""),
    CHAT_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(100),
    NOTIFICATION_OUTBOX_POLL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(500),
    /** Path to Firebase service account JSON for FCM push notifications. */
    GOOGLE_APPLICATION_CREDENTIALS: z.string().default(""),
    /** Comma-separated STUN URLs (optional; Google STUN used when empty). */
    STUN_URLS: z.string().default(""),
    /** Comma-separated TURN URLs for coturn (e.g. turn:turn.example.com:3478). */
    TURN_URLS: z.string().default(""),
    /** coturn static-auth-secret for time-limited TURN REST credentials. */
    TURN_SECRET: z.string().default(""),
    /** Fallback static TURN username when TURN_SECRET is empty. */
    TURN_USERNAME: z.string().default(""),
    /** Fallback static TURN password when TURN_SECRET is empty. */
    TURN_PASSWORD: z.string().default(""),
    /** TURN credential lifetime in seconds (REST auth). */
    TURN_CREDENTIAL_TTL_SEC: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400),
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

/** Always allowed in production (Vercel admin). Also set ADMIN_ORIGIN on the server. */
const DEFAULT_EXTRA_CORS_ORIGINS = ["https://milox-admin.vercel.app"] as const;

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function getAllowedOrigins(config: AppConfig): string[] {
  const merged = [
    config.WEB_ORIGIN,
    config.ADMIN_ORIGIN,
    ...config.CORS_ORIGINS,
    ...DEFAULT_EXTRA_CORS_ORIGINS,
  ];
  return [...new Set(merged.map(normalizeOrigin))];
}

/** Vercel preview deploys use unique subdomains (e.g. milox-admin-git-main.vercel.app). */
const VERCEL_ADMIN_ORIGIN =
  /^https:\/\/milox-admin[a-z0-9-]*\.vercel\.app$/i;

export function isAllowedCorsOrigin(
  config: AppConfig,
  origin: string | undefined,
): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (getAllowedOrigins(config).includes(normalized)) return true;
  return VERCEL_ADMIN_ORIGIN.test(normalized);
}

export function createCorsOriginChecker(config: AppConfig) {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => {
    if (isAllowedCorsOrigin(config, origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin ?? "unknown"} not allowed by CORS`));
  };
}
