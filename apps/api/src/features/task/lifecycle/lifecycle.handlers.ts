import { Injectable } from '@nestjs/common';
import {
  canDeleteOrRestore,
  canTransition,
  completedAtAfter,
  type ChangeTaskStatusRequest,
  type DeleteTaskQuery,
  type TaskResponse,
} from '@shanflow/contracts';
import { Clock } from '../../../shared/clock.js';
import type { Principal } from '../../auth/shared/principal.js';
import { appendPosition } from '../shared/position.js';
import { ForbiddenError } from '../../workspace/shared/workspace.errors.js';
import {
  InvalidStatusTransitionError,
  PositionCapacityExceededError,
  TaskNotFoundError,
} from '../shared/task.errors.js';
import { TASK_SELECT, toTask } from '../shared/task.mapper.js';
import {
  requireVersion,
  TaskMutationService,
} from '../shared/task-mutation.service.js';
import { TaskStore } from '../shared/task-store.service.js';

@Injectable()
export class LifecycleHandlers {
  constructor(
    private readonly mutations: TaskMutationService,
    private readonly store: TaskStore,
    private readonly clock: Clock,
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
        if (!canDeleteOrRestore({ role, userId: principal.userId }, task)) {
          throw task.deletedAt ? new TaskNotFoundError() : new ForbiddenError();
        }
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
}
