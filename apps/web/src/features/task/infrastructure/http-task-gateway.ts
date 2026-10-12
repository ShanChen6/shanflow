import type { TaskGateway } from '../application/task-gateway';
import { assignTask, createTask, deleteTask, listAllTasks, listTrash, loadBoardContext, moveTask, restoreTask, updateTask } from '../shared/task-client';

/** The real gateway: the task API over HTTP. */
export const httpTaskGateway: TaskGateway = {
  loadContext: loadBoardContext,
  listTasks: listAllTasks,
  listTrash,
  create: createTask,
  update: updateTask,
  move: moveTask,
  assign: assignTask,
  remove: deleteTask,
  restore: restoreTask,
};
