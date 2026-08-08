-- Step 1: extend AdPlacement enum (must commit before new values are used).
-- PostgreSQL rejects ADD VALUE + INSERT in the same transaction (SQLSTATE 55P04).

ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'NOTIFICATIONS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'MATCHES';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'INTERESTS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'PROFILE';
