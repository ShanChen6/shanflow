-- Additive Project foundation, applied atomically.
BEGIN;

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "color" TEXT,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_name_nonblank_check" CHECK (btrim("name") <> '')
);

-- CreateIndex
CREATE INDEX "projects_workspace_archive_created_id_idx" ON "projects"("workspace_id", "archived_at", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspace_id_id_key" ON "projects"("workspace_id", "id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
