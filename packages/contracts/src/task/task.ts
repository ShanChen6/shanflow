import { z } from 'zod';
import type { WorkspaceRole } from '../workspace/workspace.js';

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 10_000;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Trimmed, NFC-normalised and free of control or invisible formatting characters. */
export const taskTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(TASK_TITLE_MAX_LENGTH)
  .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value))
  .transform((value) => value.normalize('NFC'));

/** Free text: line breaks and tabs are allowed, other control/invisible characters are not. Blank means "no description". */
export const taskDescriptionSchema = z
  .string()
  .max(TASK_DESCRIPTION_MAX_LENGTH)
  .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value.replace(/[\n\t]/g, '')))
  .transform((value) => value.normalize('NFC').trim())
  .transform((value) => (value === '' ? null : value));

/**
 * A deadline is an instant (ADR-004): it must carry `Z` or a numeric offset, and is always answered in UTC.
 * A bare local date-time is rejected rather than guessed.
 */
export const dueAtSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

/** Position is a signed 64-bit rank carried as a decimal string; JSON numbers would lose precision. Clients never compute it. */
export const positionSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/);

export const taskSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** `null` means Inbox. */
  projectId: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueAt: z.iso.datetime().nullable(),
  assigneeId: z.uuid().nullable(),
  createdById: z.uuid(),
  position: positionSchema,
  /** Optimistic concurrency token: send it back on every change. */
  version: z.number().int().min(1),
  completedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Task = z.infer<typeof taskSchema>;

/**
 * Status graph (domain analysis). Moving to the same status is allowed (a no-op for the status itself);
 * CANCELED can only return to TODO, so reaching DONE from CANCELED takes two steps.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'],
  IN_PROGRESS: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'],
  DONE: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'],
  CANCELED: ['TODO', 'CANCELED'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** completedAt for a task that moves `from` → `to`: set on entering DONE, kept while it stays DONE, cleared otherwise. */
export function completedAtAfter(from: TaskStatus, to: TaskStatus, current: Date | null, now: Date): Date | null {
  if (to !== 'DONE') return null;
  return from === 'DONE' && current ? current : now;
}

/** Everything the permission matrix says about one task for one actor; the server enforces, the UI only hides controls. */
export interface TaskActor {
  role: WorkspaceRole;
  userId: string;
}
export interface TaskOwnership {
  createdById: string;
  assigneeId: string | null;
}

const isManager = (role: WorkspaceRole) => role === 'OWNER' || role === 'ADMIN';

/** Soft delete, and reading/restoring from the trash: managers any task; a plain member only tasks they created. */
export function canDeleteOrRestore(actor: TaskActor, task: TaskOwnership): boolean {
  return isManager(actor.role) || task.createdById === actor.userId;
}

/**
 * Assignee changes. Managers may set, change or clear anyone (the new assignee must still be an active member,
 * checked by the server). A plain member may only take an unassigned task for themselves or clear their own assignment.
 */
export function canChangeAssignee(actor: TaskActor, currentAssigneeId: string | null, nextAssigneeId: string | null): boolean {
  if (currentAssigneeId === nextAssigneeId) return true;
  if (isManager(actor.role)) return true;
  if (nextAssigneeId === actor.userId && currentAssigneeId === null) return true;
  return nextAssigneeId === null && currentAssigneeId === actor.userId;
}
