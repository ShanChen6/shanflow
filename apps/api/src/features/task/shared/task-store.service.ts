import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { TaskStatus } from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Tx } from '../../auth/shared/transaction.js';
import {
  ProjectArchivedError,
  ProjectNotFoundError,
} from '../../project/project.errors.js';
import { InvalidAssigneeError, TaskNotFoundError } from './task.errors.js';
import { TASK_SELECT, type StoredTask } from './task.mapper.js';

/** A lane is the ordering scope of ADR-009: workspace + project (or Inbox when null) + status. */
export interface Lane {
  workspaceId: string;
  projectId: string | null;
  status: TaskStatus;
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * Task persistence rules that every task slice shares. Every method takes the caller's transaction: authorization,
 * these checks and the write must commit together. Nothing here decides *who* may act; WorkspaceAccessService and
 * the contracts' policy functions do that.
 */
@Injectable()
export class TaskStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Serialises every task writer of a workspace (ADR-009 locking protocol). It also covers empty lanes, which a row
   * lock on tasks cannot. Callers lock first, then re-read what they depend on.
   */
  async lockWorkspace(tx: Tx, workspaceId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
  }

  /** A LIVE task by (workspace, id). Deleted tasks, other workspaces and malformed ids are all the same "not found". */
  async findLive(
    tx: Tx | PrismaService,
    workspaceId: string,
    taskId: string,
  ): Promise<StoredTask> {
    if (!isUuid(taskId)) throw new TaskNotFoundError();
    const row = await tx.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: TASK_SELECT,
    });
    if (!row) throw new TaskNotFoundError();
    return row;
  }

  /** A task of this workspace, live or deleted. Only operations that must treat both states (delete, restore) use it. */
  async findAny(
    tx: Tx | PrismaService,
    workspaceId: string,
    taskId: string,
  ): Promise<StoredTask> {
    if (!isUuid(taskId)) throw new TaskNotFoundError();
    const row = await tx.task.findFirst({
      where: { id: taskId, workspaceId },
      select: TASK_SELECT,
    });
    if (!row) throw new TaskNotFoundError();
    return row;
  }

  /** A task that is in the trash. Only the authorized trash paths call this. */
  async findDeleted(
    tx: Tx | PrismaService,
    workspaceId: string,
    taskId: string,
  ): Promise<StoredTask> {
    if (!isUuid(taskId)) throw new TaskNotFoundError();
    const row = await tx.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: { not: null } },
      select: TASK_SELECT,
    });
    if (!row) throw new TaskNotFoundError();
    return row;
  }

  /**
   * A project a task may be created in or moved to: it must exist in this workspace and not be archived
   * (ADR-003: archived projects block task changes until restored). `null` is Inbox and always allowed.
   */
  async requireEditableProject(
    tx: Tx | PrismaService,
    workspaceId: string,
    projectId: string | null,
  ): Promise<void> {
    if (projectId === null) return;
    if (!isUuid(projectId)) throw new ProjectNotFoundError();
    const project = await tx.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { archivedAt: true },
    });
    if (!project) throw new ProjectNotFoundError();
    if (project.archivedAt) throw new ProjectArchivedError();
  }

  /** The project a task currently lives in must be editable too: tasks of an archived project are frozen. */
  async requireTaskProjectEditable(
    tx: Tx | PrismaService,
    task: Pick<StoredTask, 'workspaceId' | 'projectId'>,
  ): Promise<void> {
    await this.requireEditableProject(tx, task.workspaceId, task.projectId);
  }

  /** An assignee must be an ACTIVE member with an ACTIVE account of this workspace (the FK alone allows inactive ones). */
  async requireActiveAssignee(
    tx: Tx | PrismaService,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    if (!isUuid(userId)) throw new InvalidAssigneeError();
    const member = await tx.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
        membershipStatus: 'ACTIVE',
        user: { accountStatus: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!member) throw new InvalidAssigneeError();
  }

  /** Highest live rank of a lane, or null for an empty lane. Deleted tasks do not hold a rank. */
  async lastPosition(
    tx: Tx | PrismaService,
    lane: Lane,
  ): Promise<bigint | null> {
    const row = await tx.task.findFirst({
      where: {
        workspaceId: lane.workspaceId,
        projectId: lane.projectId,
        status: lane.status,
        deletedAt: null,
      },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return row?.position ?? null;
  }

  /** Live tasks of a lane in display order. */
  laneTasks(tx: Tx | PrismaService, lane: Lane): Promise<StoredTask[]> {
    return tx.task.findMany({
      where: {
        workspaceId: lane.workspaceId,
        projectId: lane.projectId,
        status: lane.status,
        deletedAt: null,
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: TASK_SELECT,
    });
  }
}
