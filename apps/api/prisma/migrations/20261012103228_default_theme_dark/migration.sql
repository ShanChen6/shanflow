-- The app is dark first: a user who has never chosen a theme gets dark (existing rows keep what they chose).
BEGIN;

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "theme" SET DEFAULT 'DARK';

COMMIT;
