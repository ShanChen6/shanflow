import { z } from 'zod';
import { dueAtSchema, taskDescriptionSchema, taskSchema, taskTitleSchema, TASK_PRIORITIES, TASK_STATUSES } from './task.js';

/** A workspace holds at most this many tasks (live and deleted), a guard against runaway clients. */
export const MAX_TASKS_PER_WORKSPACE = 5000;
export const TASK_LIST_DEFAULT_LIMIT = 50;
export const TASK_LIST_MAX_LIMIT = 100;
export const TASK_SEARCH_MAX_LENGTH = 100;

/**
 * Creating a task. Status is always TODO, the creator is the caller, and the rank is allocated by the server, so none
 * of those can be sent (`.strict()` rejects them instead of ignoring them). `projectId: null` or omitted is Inbox.
 */
export const createTaskRequestSchema = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueAt: dueAtSchema.nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .strict();

/**
 * Editing a task's own details. Status, assignee, project and position have dedicated operations (they carry rules of
 * their own), so they are rejected here. `version` is required: it is the optimistic-concurrency token.
 */
export const updateTaskRequestSchema = z
  .object({
    version: z.number().int().min(1),
    title: taskTitleSchema,
    description: taskDescriptionSchema,
    priority: z.enum(TASK_PRIORITIES),
    dueAt: dueAtSchema.nullable(),
  })
  .partial({ title: true, description: true, priority: true, dueAt: true })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), 'Provide at least one field to change');

const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/** Filters for the list. There is deliberately no switch for deleted tasks: the trash is its own path. */
export const listTasksQuerySchema = z
  .object({
    /** A project id, or `inbox` for tasks without a project. */
    projectId: z.union([z.uuid(), z.literal('inbox')]),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    /** A user id, or `unassigned`. */
    assigneeId: z.union([z.uuid(), z.literal('unassigned')]),
    q: z.string().trim().min(1).max(TASK_SEARCH_MAX_LENGTH),
    limit: z.coerce.number().int().min(1).max(TASK_LIST_MAX_LIMIT),
    cursor: cursorSchema,
  })
  .partial()
  .strict()
  .transform((value) => ({ ...value, limit: value.limit ?? TASK_LIST_DEFAULT_LIMIT }));

export const taskResponseSchema = z.object({ task: taskSchema });
export const listTasksResponseSchema = z.object({
  tasks: z.array(taskSchema),
  /** Pass back as `cursor` for the next page; absent on the last page. */
  nextCursor: z.string().nullable(),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;
