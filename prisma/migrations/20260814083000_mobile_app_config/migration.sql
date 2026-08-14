CREATE TABLE "mobile_app_configs" (
    "id" VARCHAR(32) NOT NULL,
    "latestVersion" VARCHAR(32) NOT NULL DEFAULT '1.0.7',
    "androidMinBuild" INTEGER NOT NULL DEFAULT 0,
    "iosMinBuild" INTEGER NOT NULL DEFAULT 0,
    "forceUpdate" BOOLEAN NOT NULL DEFAULT false,
    "androidStoreUrl" VARCHAR(500) NOT NULL DEFAULT 'https://play.google.com/store/apps/details?id=com.milox.milox_mobile',
    "iosStoreUrl" VARCHAR(500) NOT NULL DEFAULT '',
    "title" VARCHAR(120) NOT NULL DEFAULT 'Update required',
    "message" VARCHAR(500) NOT NULL DEFAULT 'A new version of Milox is available. Please update to continue.',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_app_configs_pkey" PRIMARY KEY ("id")
);

INSERT INTO "mobile_app_configs" ("id", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP);
