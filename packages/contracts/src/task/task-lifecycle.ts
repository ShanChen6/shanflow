import { z } from 'zod';
import { TASK_STATUSES, taskSchema } from './task.js';
import { TASK_LIST_DEFAULT_LIMIT, TASK_LIST_MAX_LIMIT } from './task-crud.js';

/**
 * Moving a task to a status. `completedAt` and the new rank are decided by the server, so they cannot be sent.
 * `version` is the optimistic-concurrency token of the task being changed.
 */
export const changeTaskStatusRequestSchema = z
  .object({
    status: z.enum(TASK_STATUSES),
    version: z.number().int().min(1),
  })
  .strict();

export type ChangeTaskStatusRequest = z.infer<typeof changeTaskStatusRequestSchema>;

/**
 * Soft delete is `DELETE …/tasks/:id?version=N`: a body-less request that names the version the caller saw.
 * Strict, so there is no `hard`/`force` switch to ask for anything but a soft delete.
 */
export const deleteTaskQuerySchema = z
  .object({ version: z.coerce.number().int().min(1) })
  .strict();

export type DeleteTaskQuery = z.infer<typeof deleteTaskQuerySchema>;

/**
 * Restoring a deleted task. Only the version of the tombstone is sent: where the task goes (its own project or Inbox,
 * the end of its lane), and what happens to its assignee, are decided by the server.
 */
export const restoreTaskRequestSchema = z
  .object({ version: z.number().int().min(1) })
  .strict();

/** The trash lists tombstones, most recently deleted first. Nothing selects live tasks here. */
export const listTrashQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(TASK_LIST_MAX_LIMIT) })
  .partial()
  .strict()
  .transform((value) => ({ limit: value.limit ?? TASK_LIST_DEFAULT_LIMIT }));

export const trashResponseSchema = z.object({ tasks: z.array(taskSchema) });

export type RestoreTaskRequest = z.infer<typeof restoreTaskRequestSchema>;
export type ListTrashQuery = z.infer<typeof listTrashQuerySchema>;
export type TrashResponse = z.infer<typeof trashResponseSchema>;

/**
 * Assigning a task: a user id to give it to someone (or change hands), `null` to clear. The field is required, so an
 * omitted value is never mistaken for "clear". Whether the caller may do it, and whether the user is an active member,
 * is decided by the server.
 */
export const assignTaskRequestSchema = z
  .object({
    assigneeId: z.uuid().nullable(),
    version: z.number().int().min(1),
  })
  .strict();

export type AssignTaskRequest = z.infer<typeof assignTaskRequestSchema>;

/**
 * Placing a task: in its own project's lane or another's (`projectId`, `null` = Inbox, omitted = stay), in the column of
 * another status (`status`, omitted = stay), right before (`beforeId`) or right after (`afterId`) a neighbour, or at the
 * end when neither is given. Clients name neighbours; the server alone computes ranks and `completedAt`. The lane is
 * the destination project's lane for the resulting status.
 */
export const moveTaskRequestSchema = z
  .object({
    version: z.number().int().min(1),
    projectId: z.uuid().nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    beforeId: z.uuid().optional(),
    afterId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => value.beforeId === undefined || value.afterId === undefined, 'Use either beforeId or afterId, not both');

export const moveTaskResponseSchema = z.object({
  task: taskSchema,
  /** True when the lane had run out of room and was renumbered: other tasks of the lane changed rank too, so reload it. */
  laneRebalanced: z.boolean(),
});

export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;
export type MoveTaskResponse = z.infer<typeof moveTaskResponseSchema>;
