-- Point purchase rate packages (admin-managed; consumer purchase flow not wired yet).

CREATE TABLE "point_purchase_rates" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "amountMinor" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "label" VARCHAR(120),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "point_purchase_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "point_purchase_rates_isActive_sortOrder_idx" ON "point_purchase_rates"("isActive", "sortOrder");
