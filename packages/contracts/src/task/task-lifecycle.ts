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
