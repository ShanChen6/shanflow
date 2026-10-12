import { Injectable } from '@nestjs/common';
import {
  canTransition,
  completedAtAfter,
  type MoveTaskRequest,
  type MoveTaskResponse,
} from '@shanflow/contracts';
import { Clock } from '../../../shared/clock.js';
import type { Principal } from '../../auth/shared/principal.js';
import {
  insertionIndex,
  neighbourRanks,
  type Ranked,
} from '../shared/placement.js';
import { positionBetween } from '../shared/position.js';
import {
  InvalidPlacementError,
  InvalidStatusTransitionError,
  PositionCapacityExceededError,
} from '../shared/task.errors.js';
import { TASK_SELECT, toTask } from '../shared/task.mapper.js';
import {
  requireVersion,
  TaskMutationService,
} from '../shared/task-mutation.service.js';
import { TaskStore, type Lane } from '../shared/task-store.service.js';

@Injectable()
export class OrderingHandlers {
  constructor(
    private readonly mutations: TaskMutationService,
    private readonly store: TaskStore,
    private readonly clock: Clock,
  ) {}

  /**
   * Reorders a task inside its lane, moves it to another project (or Inbox) and/or drops it into another status column,
   * in one step (a board drag). The client names a neighbour; the rank, `completedAt` and the version bump are decided here. When the gap between the neighbours is used up the lane is renumbered first (and the response
   * says so). Placing a task where it already is succeeds without changing anything, so a retried move is safe.
   */
  move(
    principal: Principal,
    workspaceId: string,
    taskId: string,
    request: MoveTaskRequest,
  ): Promise<MoveTaskResponse> {
    return this.mutations.mutate(
      principal,
      workspaceId,
      taskId,
      async ({ tx, task }) => {
        const projectId =
          request.projectId === undefined ? task.projectId : request.projectId;
        const status = request.status ?? task.status;
        if (!canTransition(task.status, status))
          throw new InvalidStatusTransitionError();
        await this.store.requireEditableProject(tx, workspaceId, projectId); // the source project was checked by `mutate`
        const lane: Lane = { workspaceId, projectId, status };
        const placement = {
          beforeId: request.beforeId,
          afterId: request.afterId,
        };

        const inLane = await this.store.laneTasks(tx, lane);
        const index = insertionIndex(withoutTask(inLane, taskId), placement);
        if (index === null) throw new InvalidPlacementError();
        const alreadyThere =
          projectId === task.projectId &&
          status === task.status &&
          inLane.findIndex((candidate) => candidate.id === taskId) === index;
        if (alreadyThere) return { task: toTask(task), laneRebalanced: false };
        requireVersion(task, request.version);

        let slot = this.slotFor(inLane, taskId, placement);
        let rebalanced = false;
        if (slot.position === null) {
          rebalanced = await this.store.rebalanceLane(tx, lane);
          slot = this.slotFor(
            await this.store.laneTasks(tx, lane),
            taskId,
            placement,
          );
          if (slot.position === null) throw new PositionCapacityExceededError();
        }

        const row = await tx.task.update({
          where: { id: taskId },
          data: {
            projectId,
            status,
            position: slot.position,
            completedAt: completedAtAfter(
              task.status,
              status,
              task.completedAt,
              this.clock.now(),
            ),
            version: { increment: 1 },
          },
          select: TASK_SELECT,
        });
        return { task: toTask(row), laneRebalanced: rebalanced };
      },
    );
  }

  /** The free rank for the moved task in this lane snapshot, or `null` when its neighbours leave no room. */
  private slotFor(
    inLane: Ranked[],
    taskId: string,
    placement: { beforeId?: string; afterId?: string },
  ): { position: bigint | null } {
    const others = withoutTask(inLane, taskId);
    const index = insertionIndex(others, placement);
    if (index === null) throw new InvalidPlacementError();
    const { previous, next } = neighbourRanks(others, index);
    return { position: positionBetween(previous, next) };
  }
}

const withoutTask = (lane: Ranked[], taskId: string): Ranked[] =>
  lane.filter((candidate) => candidate.id !== taskId);
