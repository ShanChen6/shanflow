-- OAuth identities (ADR-010) and single-use tokens for email verification and password reset.
-- Applied atomically; manual CHECK constraints are listed at the end.
BEGIN;

-- CreateEnum
CREATE TYPE "oauth_provider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "one_time_token_purpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "oauth_provider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "provider_email" TEXT,
    "provider_email_verified" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "one_time_token_purpose" NOT NULL,
    "email" TEXT,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_account_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_user_provider_key" ON "oauth_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_token_hash_key" ON "one_time_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "one_time_tokens_user_purpose_idx" ON "one_time_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "one_time_tokens_expires_at_idx" ON "one_time_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Manual constraints (not expressible in Prisma schema).
ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_provider_account_id_not_blank_check"
  CHECK (btrim("provider_account_id") <> '');

ALTER TABLE "one_time_tokens"
  ADD CONSTRAINT "one_time_tokens_token_hash_format_check"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "one_time_tokens_expires_after_created_check"
  CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "one_time_tokens_verification_requires_email_check"
  CHECK ("purpose" <> 'EMAIL_VERIFICATION' OR "email" IS NOT NULL);

COMMIT;
