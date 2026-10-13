-- Uploaded avatars: the key of the stored image and when it last changed (used to version its URL).
-- An uploaded avatar takes precedence over users.avatar_url (an external provider picture).
BEGIN;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_storage_key" TEXT,
ADD COLUMN     "avatar_updated_at" TIMESTAMPTZ(3);

-- Manual constraints (not expressible in Prisma schema).
-- The key is always <user id>/<uuid>.webp, so it can never name an arbitrary path.
ALTER TABLE "users"
  ADD CONSTRAINT "users_avatar_storage_key_format_check"
  CHECK ("avatar_storage_key" IS NULL
    OR "avatar_storage_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'),
  ADD CONSTRAINT "users_avatar_key_and_timestamp_together_check"
  CHECK (("avatar_storage_key" IS NULL) = ("avatar_updated_at" IS NULL));

COMMIT;
