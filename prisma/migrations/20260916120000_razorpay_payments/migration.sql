-- Step 1/2: add enum values only.
-- PostgreSQL forbids using a newly added enum label in the same transaction
-- (ERROR 55P04). Defaults / data changes that reference RAZORPAY must run in
-- a later migration after this one commits.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PaymentGateway' AND e.enumlabel = 'RAZORPAY'
  ) THEN
    ALTER TYPE "PaymentGateway" ADD VALUE 'RAZORPAY';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VerifiedBadgePaymentMethod' AND e.enumlabel = 'RAZORPAY'
  ) THEN
    ALTER TYPE "VerifiedBadgePaymentMethod" ADD VALUE 'RAZORPAY';
  END IF;
END $$;
