import { Injectable } from '@nestjs/common';
import type { Tx } from '../../auth/shared/transaction.js';
import { TaskStore } from './task-store.service.js';

/**
 * The administrative step that must accompany taking a member out of a workspace (deactivating or removing them): their
 * assignments are cleared on EVERY task, including deleted ones and those in archived projects, so that restoring or
 * reopening a task later cannot resurrect a revoked assignment. It is the one task write allowed in a frozen project,
 * because it changes who is responsible, not the work.
 *
 * Call it in the SAME transaction as the membership change, before it. It takes the workspace lock itself, so it
 * serialises with every other task writer of the workspace.
 */
@Injectable()
export class TaskAssignmentCleanup {
  constructor(private readonly store: TaskStore) {}

  /** Returns how many tasks were freed. Repeating it finds nothing to do. */
  async unassignAll(
    tx: Tx,
    workspaceId: string,
    userId: string,
  ): Promise<number> {
    await this.store.lockWorkspace(tx, workspaceId);
    const { count } = await tx.task.updateMany({
      where: { workspaceId, assigneeId: userId },
      data: { assigneeId: null, version: { increment: 1 } },
    });
    return count;
  }
}
