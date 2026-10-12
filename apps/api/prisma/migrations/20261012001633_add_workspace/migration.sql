-- Additive migration; keep this entire change atomic.
BEGIN;

-- CreateEnum
CREATE TYPE "workspace_type" AS ENUM ('PERSONAL', 'TEAM');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" "workspace_type" NOT NULL DEFAULT 'PERSONAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspaces_name_nonblank_check" CHECK (btrim("name") <> '')
);

-- CreateIndex
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");

-- ADR-008: all persisted workspaces are active; TEAM is unrestricted.
CREATE UNIQUE INDEX "workspaces_personal_owner_unique"
    ON "workspaces"("owner_id") WHERE "type" = 'PERSONAL';

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
