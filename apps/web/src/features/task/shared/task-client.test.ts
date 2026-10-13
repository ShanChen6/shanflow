import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { assignTask, createTask, deleteTask, listAllTasks, listTrash, moveTask, restoreTask, updateTask } from './task-client';

const ws = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
const id = '2d3f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a33';
const now = '2026-10-12T00:00:00.000Z';
const ids = ['3e4f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a44', '4f507a4e-3c1d-4a6e-9b6a-2f1c8d0e5a55'];
const task = (extra: object = {}) => ({
  id,
  workspaceId: ws,
  projectId: null,
  title: 'T',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  dueAt: null,
  assigneeId: null,
  createdById: ws,
  position: '1024',
  version: 1,
  completedAt: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
const call = (n: number) => ({
  url: String(fetchMock.mock.calls[n]![0]),
  init: fetchMock.mock.calls[n]![1] as RequestInit & { headers: Record<string, string> },
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user: { id: ws, email: 'a@example.invalid', displayName: 'A', emailVerified: true } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe('listAllTasks', () => {
  it('asks for one lane scope and follows the cursor until the last page', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { tasks: [task({ id: ids[0] })], nextCursor: 'c1' }))
      .mockResolvedValueOnce(reply(200, { tasks: [task({ id: ids[1] })], nextCursor: null }));
    const result = await listAllTasks(ws, 'inbox');
    expect(result).toMatchObject({ status: 'ok' });
    if (result.status === 'ok') expect(result.data.map((t) => t.id)).toEqual(ids);
    expect(call(0).url).toMatch(new RegExp(`/workspaces/${ws}/tasks\\?projectId=inbox&limit=100$`));
    expect(call(1).url).toMatch(/cursor=c1$/);
  });

  it('filters by a project id', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { tasks: [], nextCursor: null }));
    await listAllTasks(ws, id);
    expect(call(0).url).toContain(`projectId=${id}`);
  });

  it('stops with an error instead of looping forever on a server that never ends', async () => {
    fetchMock.mockResolvedValue(reply(200, { tasks: [], nextCursor: 'again' }));
    const result = await listAllTasks(ws, 'inbox');
    expect(result.status).toBe('error');
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(60);
  });
});

describe('writes', () => {
  it('creates with only the fields given', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { task: task() }));
    const result = await createTask(ws, { title: 'T', projectId: null });
    expect(result.status).toBe('ok');
    expect(call(0).init.method).toBe('POST');
    expect(JSON.parse(String(call(0).init.body))).toEqual({ title: 'T', projectId: null });
  });

  it('edits with the version it saw', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { task: task({ version: 2 }) }));
    await updateTask(ws, id, { version: 1, title: 'New' });
    expect(call(0).init.method).toBe('PATCH');
    expect(call(0).url).toMatch(new RegExp(`/tasks/${id}$`));
  });

  it('moves with a neighbour and the version, and reports a renumbered lane', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { task: task({ status: 'DONE' }), laneRebalanced: true }));
    const result = await moveTask(ws, id, { version: 1, status: 'DONE', beforeId: ws });
    expect(result).toMatchObject({ status: 'ok', data: { laneRebalanced: true } });
    expect(call(0).url).toMatch(/\/move$/);
    expect(JSON.parse(String(call(0).init.body))).toEqual({ version: 1, status: 'DONE', beforeId: ws });
  });

  it('assigns (PUT) and clears with null', async () => {
    fetchMock.mockResolvedValue(reply(200, { task: task() }));
    await assignTask(ws, id, { assigneeId: null, version: 1 });
    expect(call(0).init.method).toBe('PUT');
    expect(call(0).url).toMatch(/\/assignee$/);
    expect(JSON.parse(String(call(0).init.body))).toEqual({ assigneeId: null, version: 1 });
  });

  it('deletes softly with the version in the query, and restores with the version in the body', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { task: task({ deletedAt: now, version: 2 }) }))
      .mockResolvedValueOnce(reply(200, { task: task({ version: 3 }) }));
    await deleteTask(ws, id, 1);
    await restoreTask(ws, id, 2);
    expect(call(0).init.method).toBe('DELETE');
    expect(call(0).url).toMatch(/\/tasks\/[^/?]+\?version=1$/);
    expect(call(1).url).toMatch(/\/restore$/);
    expect(JSON.parse(String(call(1).init.body))).toEqual({ version: 2 });
  });

  it('reads the trash from its own path', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { tasks: [task({ deletedAt: now })] }));
    const result = await listTrash(ws);
    expect(result.status).toBe('ok');
    expect(call(0).url).toMatch(new RegExp(`/workspaces/${ws}/task-trash`));
  });
});

describe('failures become one friendly message and a flag saying whether to reload', () => {
  const failing = async (status: number, code: string) => {
    fetchMock.mockResolvedValueOnce(problem(status, code));
    return moveTask(ws, id, { version: 1 });
  };

  it.each([
    [409, 'TASK_VERSION_CONFLICT', true],
    [422, 'INVALID_PLACEMENT', true],
    [404, 'NOT_FOUND', true],
    [409, 'INVALID_STATUS_TRANSITION', false],
    [409, 'PROJECT_ARCHIVED', false],
    [403, 'FORBIDDEN', false],
    [422, 'INVALID_ASSIGNEE', false],
    [409, 'TASK_LIMIT_REACHED', false],
    [409, 'POSITION_CAPACITY_EXCEEDED', false],
    [429, 'TOO_MANY_REQUESTS', false],
    [400, 'VALIDATION_FAILED', false],
  ])('%s %s', async (status, code, reload) => {
    const result = await failing(status, code);
    expect(result).toEqual({ status: 'error', message: expect.stringMatching(/\w+\s+\w+\s+\w+/), reload });
  });

  it('has an offline message, and signs out on a dead session', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await moveTask(ws, id, { version: 1 })).toEqual({ status: 'error', message: expect.stringContaining('connection'), reload: false });
  });

  it('gives different messages for different failures', async () => {
    const [a, b] = [await failing(409, 'INVALID_STATUS_TRANSITION'), await failing(409, 'PROJECT_ARCHIVED')];
    expect(a).not.toEqual(b);
  });
});
