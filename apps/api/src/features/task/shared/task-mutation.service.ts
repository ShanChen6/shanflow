import { Injectable } from '@nestjs/common';
import type { WorkspaceRole } from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Principal } from '../../auth/shared/principal.js';
import type { Tx } from '../../auth/shared/transaction.js';
import { WorkspaceAccessService } from '../../workspace/shared/workspace-access.service.js';
import { TaskVersionConflictError } from './task.errors.js';
import type { StoredTask } from './task.mapper.js';
import { TaskStore } from './task-store.service.js';

export interface MutationContext {
  tx: Tx;
  role: WorkspaceRole;
  task: StoredTask;
}

/**
 * The shared opening of every change to one existing task, in one transaction: the caller is an active member
 * (membership share-locked), writers of the workspace are serialised, the task is live and its project is not archived.
 */
@Injectable()
export class TaskMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly store: TaskStore,
  ) {}

  /** Opens the transaction for a change to a workspace's tasks: active member (share-locked), workspace writers serialised. */
  inWorkspace<T>(
    principal: Principal,
    workspaceId: string,
    work: (context: { tx: Tx; role: WorkspaceRole }) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const { role } = await this.access.require(
        principal.userId,
        workspaceId,
        { lock: true },
        tx,
      );
      await this.store.lockWorkspace(tx, workspaceId);
      return work({ tx, role });
    });
  }

  /** `inWorkspace` for one existing LIVE task whose project is not archived. */
  mutate<T>(
    principal: Principal,
    workspaceId: string,
    taskId: string,
    work: (context: MutationContext) => Promise<T>,
  ): Promise<T> {
    return this.inWorkspace(principal, workspaceId, async ({ tx, role }) => {
      const task = await this.store.findLive(tx, workspaceId, taskId);
      await this.store.requireTaskProjectEditable(tx, task);
      return work({ tx, role, task });
    });
  }
}

/** Guard for optimistic concurrency: the caller must have seen the task's current version. */
export function requireVersion(
  task: Pick<StoredTask, 'version'>,
  version: number,
): void {
  if (task.version !== version) throw new TaskVersionConflictError();
}
