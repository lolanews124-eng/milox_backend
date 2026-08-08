-- Repair: add AdPlacement enum values when migration 20260808120000 was marked
-- applied without running (e.g. after migrate resolve --applied).
-- Safe to run multiple times (IF NOT EXISTS).
-- Run each statement separately so PostgreSQL commits enum values before use.

ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'NOTIFICATIONS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'MATCHES';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'INTERESTS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'PROFILE';
