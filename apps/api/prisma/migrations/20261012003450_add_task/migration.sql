-- Additive Task foundation and required guards, applied atomically.
BEGIN;

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "task_status" NOT NULL DEFAULT 'TODO',
    "priority" "task_priority" NOT NULL DEFAULT 'MEDIUM',
    "due_at" TIMESTAMPTZ(3),
    "assignee_id" UUID,
    "created_by_id" UUID NOT NULL,
    "position" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_title_nonblank_check" CHECK (btrim("title") <> ''),
    CONSTRAINT "tasks_completion_check" CHECK (
        ("status" = 'DONE' AND "completed_at" IS NOT NULL) OR
        ("status" <> 'DONE' AND "completed_at" IS NULL)
    ),
    CONSTRAINT "tasks_position_nonnegative_check" CHECK ("position" >= 0),
    CONSTRAINT "tasks_version_positive_check" CHECK ("version" >= 1)
);

-- CreateIndex
CREATE INDEX "tasks_workspace_project_idx" ON "tasks"("workspace_id", "project_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_creator_idx" ON "tasks"("workspace_id", "created_by_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_assignee_idx" ON "tasks"("workspace_id", "assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workspace_id_id_key" ON "tasks"("workspace_id", "id");

-- ADR-009: strict positions for live Project lanes.
CREATE UNIQUE INDEX "task_live_project_position_unique"
    ON "tasks"("workspace_id", "project_id", "status", "position")
    WHERE "deleted_at" IS NULL AND "project_id" IS NOT NULL;

-- ADR-009: strict positions for live Inbox lanes (NULL project is one partition).
CREATE UNIQUE INDEX "task_live_inbox_position_unique"
    ON "tasks"("workspace_id", "status", "position")
    WHERE "deleted_at" IS NULL AND "project_id" IS NULL;

-- Query indexes exclude tombstones where the ordinary application views do.
CREATE INDEX "tasks_live_status_idx"
    ON "tasks"("workspace_id", "status", "id") WHERE "deleted_at" IS NULL;
CREATE INDEX "tasks_live_assignee_status_idx"
    ON "tasks"("workspace_id", "assignee_id", "status", "id")
    WHERE "deleted_at" IS NULL AND "assignee_id" IS NOT NULL;
CREATE INDEX "tasks_live_due_idx"
    ON "tasks"("workspace_id", "due_at", "id")
    WHERE "deleted_at" IS NULL AND "due_at" IS NOT NULL;
CREATE INDEX "tasks_trash_idx"
    ON "tasks"("workspace_id", "deleted_at", "id")
    WHERE "deleted_at" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_created_by_id_fkey" FOREIGN KEY ("workspace_id", "created_by_id") REFERENCES "workspace_members"("workspace_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_assignee_id_fkey" FOREIGN KEY ("workspace_id", "assignee_id") REFERENCES "workspace_members"("workspace_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
