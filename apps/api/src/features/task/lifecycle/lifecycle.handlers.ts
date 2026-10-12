import { Injectable } from '@nestjs/common';
import {
  canDeleteOrRestore,
  WORKSPACE_MANAGER_ROLES,
  type TaskActor,
  canTransition,
  completedAtAfter,
  type ChangeTaskStatusRequest,
  type DeleteTaskQuery,
  type ListTrashQuery,
  type RestoreTaskRequest,
  type TrashResponse,
  type TaskResponse,
} from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import { WorkspaceAccessService } from '../../workspace/shared/workspace-access.service.js';
import type { Principal } from '../../auth/shared/principal.js';
import { appendPosition } from '../shared/position.js';
import { ForbiddenError } from '../../workspace/shared/workspace.errors.js';
import {
  InvalidStatusTransitionError,
  PositionCapacityExceededError,
  TaskNotFoundError,
} from '../shared/task.errors.js';
import { TASK_SELECT, toTask, type StoredTask } from '../shared/task.mapper.js';
import {
  requireVersion,
  TaskMutationService,
} from '../shared/task-mutation.service.js';
import { TaskStore } from '../shared/task-store.service.js';

/**
 * Deleting and restoring share one rule (`canDeleteOrRestore`). Someone who lacks it is told "forbidden" about a live
 * task they can already see, but "not found" about a deleted one: the trash is invisible to them.
 */
function requireTrashPermission(actor: TaskActor, task: StoredTask): void {
  if (canDeleteOrRestore(actor, task)) return;
  throw task.deletedAt ? new TaskNotFoundError() : new ForbiddenError();
}

@Injectable()
export class LifecycleHandlers {
  constructor(
    private readonly mutations: TaskMutationService,
    private readonly store: TaskStore,
    private readonly clock: Clock,
    private readonly access: WorkspaceAccessService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Moves the task to the end of the lane of its new status and keeps `completedAt` in step (set on entering DONE,
   * cleared on leaving it). Asking for the status it already has changes nothing and succeeds, so a retried request is safe.
   */
  changeStatus(
    principal: Principal,
    workspaceId: string,
    taskId: string,
    request: ChangeTaskStatusRequest,
  ): Promise<TaskResponse> {
    return this.mutations.mutate(
      principal,
      workspaceId,
      taskId,
      async ({ tx, task }) => {
        if (task.status === request.status) return { task: toTask(task) };
        requireVersion(task, request.version);
        if (!canTransition(task.status, request.status))
          throw new InvalidStatusTransitionError();

        const lane = {
          workspaceId,
          projectId: task.projectId,
          status: request.status,
        };
        const position = appendPosition(
          await this.store.lastPosition(tx, lane),
        );
        if (position === null) throw new PositionCapacityExceededError();

        const row = await tx.task.update({
          where: { id: taskId },
          data: {
            status: request.status,
            position,
            completedAt: completedAtAfter(
              task.status,
              request.status,
              task.completedAt,
              this.clock.now(),
            ),
            version: { increment: 1 },
          },
          select: TASK_SELECT,
        });
        return { task: toTask(row) };
      },
    );
  }

  /**
   * Soft delete: stamps `deletedAt` and nothing else (status, completion, rank and history stay), which releases the
   * rank in its lane. Idempotent: an already-deleted task is returned as it is. Whoever may not delete does not get to
   * learn that a deleted task exists, so for them it is "not found".
   */
  remove(
    principal: Principal,
    workspaceId: string,
    taskId: string,
    query: DeleteTaskQuery,
  ): Promise<TaskResponse> {
    return this.mutations.inWorkspace(
      principal,
      workspaceId,
      async ({ tx, role }) => {
        const task = await this.store.findAny(tx, workspaceId, taskId);
        requireTrashPermission({ role, userId: principal.userId }, task);
        if (task.deletedAt) return { task: toTask(task) };

        await this.store.requireTaskProjectEditable(tx, task);
        requireVersion(task, query.version);
        const row = await tx.task.update({
          where: { id: taskId },
          data: { deletedAt: this.clock.now(), version: { increment: 1 } },
          select: TASK_SELECT,
        });
        return { task: toTask(row) };
      },
    );
  }

  /**
   * Brings a deleted task back to its own project (or Inbox) at the END of the lane of its status. The old rank is never
   * reused, so a rank taken in the meantime cannot collide. Idempotent: a live task is returned as it is. An assignee who is
   * no longer an active member is cleared rather than resurrected.
   */
  restore(
    principal: Principal,
    workspaceId: string,
    taskId: string,
    request: RestoreTaskRequest,
  ): Promise<TaskResponse> {
    return this.mutations.inWorkspace(
      principal,
      workspaceId,
      async ({ tx, role }) => {
        const task = await this.store.findAny(tx, workspaceId, taskId);
        requireTrashPermission({ role, userId: principal.userId }, task);
        if (!task.deletedAt) return { task: toTask(task) };

        await this.store.requireEditableProject(
          tx,
          workspaceId,
          task.projectId,
        );
        requireVersion(task, request.version);

        const lane = {
          workspaceId,
          projectId: task.projectId,
          status: task.status,
        };
        const position = appendPosition(
          await this.store.lastPosition(tx, lane),
        );
        if (position === null) throw new PositionCapacityExceededError();
        const keepsAssignee =
          task.assigneeId !== null &&
          (await this.store.isActiveMember(tx, workspaceId, task.assigneeId));

        const row = await tx.task.update({
          where: { id: taskId },
          data: {
            deletedAt: null,
            position,
            assigneeId: keepsAssignee ? task.assigneeId : null,
            version: { increment: 1 },
          },
          select: TASK_SELECT,
        });
        return { task: toTask(row) };
      },
    );
  }

  /** Tombstones the caller may see: managers all of them, a plain member only those they created. Most recent first. */
  async listTrash(
    principal: Principal,
    workspaceId: string,
    query: ListTrashQuery,
  ): Promise<TrashResponse> {
    const { role } = await this.access.require(principal.userId, workspaceId);
    const isManager = (WORKSPACE_MANAGER_ROLES as readonly string[]).includes(
      role,
    );
    const rows = await this.prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: { not: null },
        ...(!isManager && { createdById: principal.userId }),
      },
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      select: TASK_SELECT,
    });
    return { tasks: rows.map(toTask) };
  }
}
