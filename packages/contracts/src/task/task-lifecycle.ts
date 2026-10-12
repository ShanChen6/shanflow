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
