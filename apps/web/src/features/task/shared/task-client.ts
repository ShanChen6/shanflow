import {
  listMembersResponseSchema,
  listProjectsResponseSchema,
  listTasksResponseSchema,
  listWorkspacesResponseSchema,
  moveTaskResponseSchema,
  taskResponseSchema,
  trashResponseSchema,
  type AssignTaskRequest,
  type CreateTaskRequest,
  type ListTasksResponse,
  type MoveTaskRequest,
  type Project,
  type Task,
  type UpdateTaskRequest,
  type Workspace,
  type WorkspaceMember,
} from '@shanflow/contracts';
import { authedDeleteJson, authedGetJson, authedPatchJson, authedPostJson, authedPutJson, type AuthedResult } from '@/features/auth/shared/auth-client';
import { failureFor, type TaskFailure } from './task-messages';

export type TaskResult<T> = { status: 'ok'; data: T } | TaskFailure | { status: 'signed-out' };

/** Turns the shared client's result into one the screens can branch on: data, a friendly failure, or signed out. */
function settle<T>(result: AuthedResult<T>): TaskResult<T> {
  if (result.ok) return { status: 'ok', data: result.data };
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  return failureFor(result.kind === 'problem' ? result.problem.code : undefined);
}

const tasksPath = (workspaceId: string) => `/workspaces/${workspaceId}/tasks`;

/** A board scope: `inbox`, or a project id. */
export type Scope = 'inbox' | string;

const PAGE_SIZE = 100;
/** A workspace holds at most 5000 tasks, so 50 pages is more than any real list; the cap only guards against a server that never ends. */
const MAX_PAGES = 50;

/** Every live task of a scope (the board needs the whole lane to place cards), following the cursor. */
export async function listAllTasks(workspaceId: string, scope: Scope): Promise<TaskResult<Task[]>> {
  const tasks: Task[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: string = `projectId=${encodeURIComponent(scope)}&limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const result: TaskResult<ListTasksResponse> = settle(await authedGetJson(`${tasksPath(workspaceId)}?${query}`, listTasksResponseSchema));
    if (result.status !== 'ok') return result;
    tasks.push(...result.data.tasks);
    if (result.data.nextCursor === null) return { status: 'ok', data: tasks };
    cursor = result.data.nextCursor;
  }
  return failureFor(undefined);
}

export async function createTask(workspaceId: string, body: CreateTaskRequest): Promise<TaskResult<Task>> {
  const result = settle(await authedPostJson(tasksPath(workspaceId), body, taskResponseSchema));
  return result.status === 'ok' ? { status: 'ok', data: result.data.task } : result;
}

export async function updateTask(workspaceId: string, taskId: string, body: UpdateTaskRequest): Promise<TaskResult<Task>> {
  const result = settle(await authedPatchJson(`${tasksPath(workspaceId)}/${taskId}`, body, taskResponseSchema));
  return result.status === 'ok' ? { status: 'ok', data: result.data.task } : result;
}

/** Reorders, changes project and/or status in one step. `laneRebalanced` means other cards of the lane changed rank too. */
export async function moveTask(workspaceId: string, taskId: string, body: MoveTaskRequest): Promise<TaskResult<{ task: Task; laneRebalanced: boolean }>> {
  return settle(await authedPostJson(`${tasksPath(workspaceId)}/${taskId}/move`, body, moveTaskResponseSchema));
}

export async function assignTask(workspaceId: string, taskId: string, body: AssignTaskRequest): Promise<TaskResult<Task>> {
  const result = settle(await authedPutJson(`${tasksPath(workspaceId)}/${taskId}/assignee`, body, taskResponseSchema));
  return result.status === 'ok' ? { status: 'ok', data: result.data.task } : result;
}

export async function deleteTask(workspaceId: string, taskId: string, version: number): Promise<TaskResult<Task>> {
  const result = settle(await authedDeleteJson(`${tasksPath(workspaceId)}/${taskId}?version=${version}`, taskResponseSchema));
  return result.status === 'ok' ? { status: 'ok', data: result.data.task } : result;
}

export async function restoreTask(workspaceId: string, taskId: string, version: number): Promise<TaskResult<Task>> {
  const result = settle(await authedPostJson(`${tasksPath(workspaceId)}/${taskId}/restore`, { version }, taskResponseSchema));
  return result.status === 'ok' ? { status: 'ok', data: result.data.task } : result;
}

export async function listTrash(workspaceId: string): Promise<TaskResult<Task[]>> {
  const result = settle(await authedGetJson(`/workspaces/${workspaceId}/task-trash?limit=${PAGE_SIZE}`, trashResponseSchema));
  return result.status === 'ok' ? { status: 'ok', data: result.data.tasks } : result;
}

export interface BoardContext {
  workspace: Workspace;
  projects: Project[];
  members: WorkspaceMember[];
}

/** What the board needs besides tasks: my workspace (and my role in it), its active projects and its members. */
export async function loadBoardContext(): Promise<TaskResult<BoardContext>> {
  const list = settle(await authedGetJson('/workspaces', listWorkspacesResponseSchema));
  if (list.status !== 'ok') return list;
  const workspace = list.data.workspaces[0];
  if (!workspace) return failureFor(undefined);

  const [projects, members] = await Promise.all([
    authedGetJson(`/workspaces/${workspace.id}/projects?status=active`, listProjectsResponseSchema),
    authedGetJson(`/workspaces/${workspace.id}/members`, listMembersResponseSchema),
  ]);
  const projectsResult = settle(projects);
  if (projectsResult.status !== 'ok') return projectsResult;
  const membersResult = settle(members);
  if (membersResult.status !== 'ok') return membersResult;
  return { status: 'ok', data: { workspace, projects: projectsResult.data.projects, members: membersResult.data.members } };
}
