import type { Project, Task, WorkspaceMember, WorkspaceRole } from '@shanflow/contracts';
import { vi } from 'vitest';

export const WS = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
export const ME = '1c2f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a22';
export const OTHER = '2d3f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a33';
export const PROJECT = '3e4f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a44';
const NOW = '2026-10-12T00:00:00.000Z';

let counter = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function makeTask(extra: Partial<Task> = {}): Task {
  return {
    id: uuid(), workspaceId: WS, projectId: null, title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM', dueAt: null,
    assigneeId: null, createdById: ME, position: '1024', version: 1, completedAt: null, deletedAt: null, createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

export interface FakeApi {
  tasks: Task[];
  /** Every request as "METHOD /path" with its parsed JSON body. */
  requests: Array<{ line: string; body?: unknown }>;
  /** Make the next matching request fail with a problem document. */
  failNext(match: RegExp, status: number, code: string): void;
}

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

/**
 * A small in-memory stand-in for the task endpoints: enough behaviour (versions, lanes, deleted tasks) to exercise the screen
 * end to end. It is not the real server; the API has its own database tests.
 */
export function installFakeTaskApi(options: { tasks?: Task[]; role?: WorkspaceRole; projects?: Project[]; members?: WorkspaceMember[] } = {}): FakeApi {
  const state: FakeApi = { tasks: options.tasks ?? [], requests: [], failNext: () => undefined };
  const failures: Array<{ match: RegExp; status: number; code: string }> = [];
  state.failNext = (match, status, code) => failures.push({ match, status, code });
  const role = options.role ?? 'OWNER';
  const projects = options.projects ?? [{ id: PROJECT, workspaceId: WS, name: 'Website', description: null, color: null, icon: null, archivedAt: null, createdAt: NOW, updatedAt: NOW }];
  const members = options.members ?? [
    { userId: ME, displayName: 'Me', role, joinedAt: NOW },
    { userId: OTHER, displayName: 'Olive', role: 'MEMBER', joinedAt: NOW },
  ];
  const lane = (t: Pick<Task, 'projectId' | 'status'>) => state.tasks.filter((x) => !x.deletedAt && x.projectId === t.projectId && x.status === t.status);
  const endRank = (t: Pick<Task, 'projectId' | 'status'>) => String(lane(t).reduce((max, x) => Math.max(max, Number(x.position)), 0) + 1024);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname + new URL(url).search;
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      state.requests.push({ line: `${method} ${path}`, body });

      const failure = failures.findIndex((f) => f.match.test(`${method} ${path}`));
      if (failure !== -1) {
        const f = failures.splice(failure, 1)[0]!;
        return json(f.status, { type: 't', title: 'x', status: f.status, code: f.code });
      }

      if (method === 'GET' && path === '/workspaces') return json(200, { workspaces: [{ id: WS, name: 'Personal', type: 'PERSONAL', role, createdAt: NOW, updatedAt: NOW }] });
      if (method === 'GET' && path.startsWith(`/workspaces/${WS}/projects`)) return json(200, { projects });
      if (method === 'GET' && path === `/workspaces/${WS}/members`) return json(200, { members });
      if (method === 'GET' && path.startsWith(`/workspaces/${WS}/task-trash`)) return json(200, { tasks: state.tasks.filter((t) => t.deletedAt) });
      if (method === 'GET' && path.startsWith(`/workspaces/${WS}/tasks?`)) {
        const scope = new URL(url).searchParams.get('projectId');
        const wanted = scope === 'inbox' ? null : scope;
        return json(200, { tasks: state.tasks.filter((t) => !t.deletedAt && t.projectId === wanted), nextCursor: null });
      }

      const taskPath = new RegExp(`^/workspaces/${WS}/tasks(?:/([^/?]+)(?:/(move|assignee|restore))?)?(?:\\?(.*))?$`).exec(path);
      if (!taskPath) return json(404, { type: 't', title: 'x', status: 404, code: 'NOT_FOUND' });
      const [, id, action, query] = taskPath;

      if (method === 'POST' && !id) {
        const created = makeTask({ title: body.title, projectId: body.projectId ?? null, priority: body.priority ?? 'MEDIUM', position: endRank({ projectId: body.projectId ?? null, status: 'TODO' }) });
        state.tasks.push(created);
        return json(201, { task: created });
      }
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return json(404, { type: 't', title: 'x', status: 404, code: 'NOT_FOUND' });

      if (method === 'POST' && action === 'move') {
        const status = body.status ?? task.status;
        const projectId = body.projectId === undefined ? task.projectId : body.projectId;
        const others = lane({ projectId, status }).filter((t) => t.id !== task.id);
        const beforeId = body.beforeId as string | undefined;
        const afterId = body.afterId as string | undefined;
        let position = endRank({ projectId, status });
        if (beforeId) position = String(Number(others.find((t) => t.id === beforeId)!.position) - 1);
        if (afterId) position = String(Number(others.find((t) => t.id === afterId)!.position) + 1);
        Object.assign(task, { status, projectId, position, version: task.version + 1, completedAt: status === 'DONE' ? NOW : null });
        return json(200, { task, laneRebalanced: false });
      }
      if (method === 'PUT' && action === 'assignee') {
        Object.assign(task, { assigneeId: body.assigneeId, version: task.version + 1 });
        return json(200, { task });
      }
      if (method === 'POST' && action === 'restore') {
        Object.assign(task, { deletedAt: null, version: task.version + 1, position: endRank(task) });
        return json(200, { task });
      }
      if (method === 'PATCH') {
        const { version: _version, ...changes } = body;
        Object.assign(task, changes, { version: task.version + 1 });
        return json(200, { task });
      }
      if (method === 'DELETE' && query) {
        Object.assign(task, { deletedAt: NOW, version: task.version + 1 });
        return json(200, { task });
      }
      return json(404, { type: 't', title: 'x', status: 404, code: 'NOT_FOUND' });
    }),
  );
  return state;
}
