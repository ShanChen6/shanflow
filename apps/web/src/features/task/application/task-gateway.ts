import type { AssignTaskRequest, CreateTaskRequest, MoveTaskRequest, Task, UpdateTaskRequest } from '@shanflow/contracts';
import type { BoardContext, Scope, TaskResult } from '../shared/task-client';

/**
 * What the board needs from the outside world, as a port. The use cases (`useBoard`) depend on this, never on HTTP, so
 * they can be driven by a fake in tests and the transport can change without touching them.
 */
export interface TaskGateway {
  loadContext(): Promise<TaskResult<BoardContext>>;
  listTasks(workspaceId: string, scope: Scope): Promise<TaskResult<Task[]>>;
  listTrash(workspaceId: string): Promise<TaskResult<Task[]>>;
  create(workspaceId: string, body: CreateTaskRequest): Promise<TaskResult<Task>>;
  update(workspaceId: string, taskId: string, body: UpdateTaskRequest): Promise<TaskResult<Task>>;
  move(workspaceId: string, taskId: string, body: MoveTaskRequest): Promise<TaskResult<{ task: Task; laneRebalanced: boolean }>>;
  assign(workspaceId: string, taskId: string, body: AssignTaskRequest): Promise<TaskResult<Task>>;
  remove(workspaceId: string, taskId: string, version: number): Promise<TaskResult<Task>>;
  restore(workspaceId: string, taskId: string, version: number): Promise<TaskResult<Task>>;
}
