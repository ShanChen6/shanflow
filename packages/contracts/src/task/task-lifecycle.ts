import { z } from 'zod';
import { TASK_STATUSES } from './task.js';

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
