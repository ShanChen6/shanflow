-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "account_status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_canonical_check"
        CHECK ("email" <> '' AND "email" = btrim("email") AND "email" = lower("email")),
    CONSTRAINT "users_display_name_nonblank_check"
        CHECK (btrim("display_name") <> '')
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
