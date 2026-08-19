CREATE TABLE "paypal_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "clientId" VARCHAR(255) NOT NULL DEFAULT '',
    "clientSecret" TEXT NOT NULL DEFAULT '',
    "mode" VARCHAR(16) NOT NULL DEFAULT 'live',
    "webhookId" VARCHAR(255) NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paypal_settings_pkey" PRIMARY KEY ("id")
);
