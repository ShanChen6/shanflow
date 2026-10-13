-- Per-user preferences (locale, time zone, theme). One optional row per user; no row means defaults.
BEGIN;

-- CreateEnum
CREATE TYPE "theme_preference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "theme" "theme_preference" NOT NULL DEFAULT 'SYSTEM',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual constraints (not expressible in Prisma schema); the API validates the same sets.
ALTER TABLE "user_settings"
  ADD CONSTRAINT "user_settings_locale_check" CHECK ("locale" IN ('en', 'vi')),
  ADD CONSTRAINT "user_settings_time_zone_length_check" CHECK (char_length("time_zone") BETWEEN 1 AND 64);

COMMIT;
