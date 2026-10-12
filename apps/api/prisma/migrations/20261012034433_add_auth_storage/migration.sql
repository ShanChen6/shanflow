-- Auth storage per ADR-010: password credential, refresh sessions, email verification marker.
-- Applied atomically; manual CHECK constraints are listed at the end.
BEGIN;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "password_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "last_used_at" TIMESTAMPTZ(3),
    "device_label" TEXT,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_id_key" ON "refresh_sessions"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions"("family_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_sessions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Manual constraints (not expressible in Prisma schema).
ALTER TABLE "password_credentials"
  ADD CONSTRAINT "password_credentials_password_hash_not_blank_check"
  CHECK (btrim("password_hash") <> '');

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_token_hash_format_check"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "refresh_sessions_expires_after_created_check"
  CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "refresh_sessions_not_self_replaced_check"
  CHECK ("replaced_by_id" IS NULL OR "replaced_by_id" <> "id"),
  ADD CONSTRAINT "refresh_sessions_replaced_requires_used_check"
  CHECK ("replaced_by_id" IS NULL OR "used_at" IS NOT NULL);

COMMIT;
