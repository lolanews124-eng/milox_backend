-- Mentions in posts notify tagged users.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'POST_MENTION';
