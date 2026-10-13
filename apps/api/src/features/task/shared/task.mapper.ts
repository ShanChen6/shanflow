import type { Task } from '@shanflow/contracts';
import { positionToString } from './position.js';

/** The columns every task read selects; the allow-list keeps queries and the mapper in step. */
export const TASK_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  assigneeId: true,
  createdById: true,
  position: true,
  version: true,
  completedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface StoredTask {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: Task['status'];
  priority: Task['priority'];
  dueAt: Date | null;
  assigneeId: string | null;
  createdById: string;
  position: bigint;
  version: number;
  completedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function toTask(row: StoredTask): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: iso(row.dueAt),
    assigneeId: row.assigneeId,
    createdById: row.createdById,
    position: positionToString(row.position),
    version: row.version,
    completedAt: iso(row.completedAt),
    deletedAt: iso(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
