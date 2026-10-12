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
  TaskVersionConflictError,
} from './shared/task.errors.js';
import { TASK_SELECT, toTask } from './shared/task.mapper.js';
import { TaskStore } from './shared/task-store.service.js';

@Injectable()
export class TaskHandlers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly store: TaskStore,
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
    return this.prisma.$transaction(async (tx) => {
      await this.access.require(
        principal.userId,
        workspaceId,
        { lock: true },
        tx,
      );
      await this.store.lockWorkspace(tx, workspaceId);
      const current = await this.store.findLive(tx, workspaceId, taskId);
      await this.store.requireTaskProjectEditable(tx, current);
      if (current.version !== request.version)
        throw new TaskVersionConflictError();

      const row = await tx.task.update({
        where: { id: taskId },
        data: {
          ...(request.title !== undefined && { title: request.title }),
          ...(request.description !== undefined && {
            description: request.description,
          }),
          ...(request.priority !== undefined && { priority: request.priority }),
          ...(request.dueAt !== undefined && {
            dueAt: request.dueAt ? new Date(request.dueAt) : null,
          }),
          version: { increment: 1 },
        },
        select: TASK_SELECT,
      });
      return { task: toTask(row) };
    });
  }
}
