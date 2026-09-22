-- Daily missions + streak milestone wallet types.
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'DAILY_MISSION';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'STREAK_MILESTONE';
