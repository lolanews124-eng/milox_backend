-- New enum values must commit before they are used.
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'REELS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'STORIES';
