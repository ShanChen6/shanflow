import { Injectable } from '@nestjs/common';
import {
  MAX_TASKS_PER_WORKSPACE,
  canChangeAssignee,
  type CreateTaskRequest,
  type ListTasksQuery,
  type ListTasksResponse,
  type TaskResponse,
  type UpdateTaskRequest,
} from '@shanflow/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import type { Principal } from '../auth/shared/principal.js';
import { ForbiddenError } from '../workspace/shared/workspace.errors.js';
import { WorkspaceAccessService } from '../workspace/shared/workspace-access.service.js';
import { decodeCursor, encodeCursor } from './shared/cursor.js';
import { appendPosition } from './shared/position.js';
import {
  PositionCapacityExceededError,
  TaskLimitReachedError,
} from './shared/task.errors.js';
import { TASK_SELECT, toTask, type StoredTask } from './shared/task.mapper.js';
import {
  requireVersion,
  TaskMutationService,
} from './shared/task-mutation.service.js';
import { TaskStore } from './shared/task-store.service.js';

interface DetailChanges {
  title?: string;
  description?: string | null;
  priority?: StoredTask['priority'];
  dueAt?: Date | null;
}

/** The fields of `request` that really differ from the stored task, or `null` when the edit would change nothing. */
function detailChanges(
  task: StoredTask,
  request: UpdateTaskRequest,
): DetailChanges | null {
  const changes: DetailChanges = {};
  if (request.title !== undefined && request.title !== task.title)
    changes.title = request.title;
  if (
    request.description !== undefined &&
    request.description !== task.description
  )
    changes.description = request.description;
  if (request.priority !== undefined && request.priority !== task.priority)
    changes.priority = request.priority;
  if (request.dueAt !== undefined) {
    const dueAt = request.dueAt ? new Date(request.dueAt) : null;
    if ((dueAt?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null))
      changes.dueAt = dueAt;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

@Injectable()
export class TaskHandlers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly store: TaskStore,
    private readonly mutations: TaskMutationService,
  ) {}

  create(
    principal: Principal,
    workspaceId: string,
    request: CreateTaskRequest,
  ): Promise<TaskResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { role } = await this.access.require(
        principal.userId,
        workspaceId,
        { lock: true },
        tx,
      );
      await this.store.lockWorkspace(tx, workspaceId);

      // Counted under the workspace lock, so concurrent creations cannot overshoot the limit.
      if (
        (await tx.task.count({ where: { workspaceId } })) >=
        MAX_TASKS_PER_WORKSPACE
      )
        throw new TaskLimitReachedError();

      const projectId = request.projectId ?? null;
      await this.store.requireEditableProject(tx, workspaceId, projectId);

      const assigneeId = request.assigneeId ?? null;
      if (assigneeId !== null) {
        // A plain member may only assign themselves; the new assignee must be an active member either way.
        if (
          !canChangeAssignee(
            { role, userId: principal.userId },
            null,
            assigneeId,
          )
        )
          throw new ForbiddenError();
        await this.store.requireActiveAssignee(tx, workspaceId, assigneeId);
      }

      const lane = { workspaceId, projectId, status: 'TODO' as const };
      const position = appendPosition(await this.store.lastPosition(tx, lane));
      if (position === null) throw new PositionCapacityExceededError();

      const row = await tx.task.create({
        data: {
          workspaceId,
          createdById: principal.userId,
          title: request.title,
          description: request.description ?? null,
          priority: request.priority,
          dueAt: request.dueAt ? new Date(request.dueAt) : null,
          projectId,
          assigneeId,
          position,
        },
        select: TASK_SELECT,
      });
      return { task: toTask(row) };
    });
  }

  async get(
    principal: Principal,
    workspaceId: string,
    taskId: string,
  ): Promise<TaskResponse> {
    await this.access.require(principal.userId, workspaceId);
    return {
      task: toTask(await this.store.findLive(this.prisma, workspaceId, taskId)),
    };
  }

  /** Live tasks only, in lane order (position, then id), filtered; paged with an opaque keyset cursor. */
  async list(
    principal: Principal,
    workspaceId: string,
    query: ListTasksQuery,
  ): Promise<ListTasksResponse> {
    await this.access.require(principal.userId, workspaceId);
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(query.projectId !== undefined && {
          projectId: query.projectId === 'inbox' ? null : query.projectId,
        }),
        ...(query.status && { status: query.status }),
        ...(query.priority && { priority: query.priority }),
        ...(query.assigneeId !== undefined && {
          assigneeId:
            query.assigneeId === 'unassigned' ? null : query.assigneeId,
        }),
        ...(query.q && {
          // Prisma does not escape LIKE wildcards: do it, so "%" and "_" search for themselves.
          title: {
            contains: query.q.replace(/[\\%_]/g, '\\$&'),
            mode: 'insensitive' as const,
          },
        }),
        ...(after && {
          OR: [
            { position: { gt: after.position } },
            { position: after.position, id: { gt: after.id } },
          ],
        }),
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: TASK_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      tasks: page.map(toTask),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ position: last.position, id: last.id })
          : null,
    };
  }

  /**
   * Edits the task's own details. Status, assignee, project and position are separate operations. The caller's
   * `version` must still be current: a stale one is a conflict, never a silent overwrite.
   */
  update(
    principal: Principal,
    workspaceId: string,
    taskId: string,
    request: UpdateTaskRequest,
  ): Promise<TaskResponse> {
    return this.mutations.mutate(
      principal,
      workspaceId,
      taskId,
      async ({ tx, task }) => {
        const changes = detailChanges(task, request);
        // Nothing would change: succeed as is. A retry of an edit that already went through is therefore safe.
        if (!changes) return { task: toTask(task) };
        requireVersion(task, request.version);

        const row = await tx.task.update({
          where: { id: taskId },
          data: { ...changes, version: { increment: 1 } },
          select: TASK_SELECT,
        });
        return { task: toTask(row) };
      },
    );
  }
}
