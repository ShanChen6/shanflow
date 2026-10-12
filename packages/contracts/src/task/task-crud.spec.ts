import { describe, expect, it } from 'vitest';
import { createTaskRequestSchema, listTasksQuerySchema, updateTaskRequestSchema } from './task-crud.js';

const uuid = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';

describe('createTaskRequestSchema', () => {
  it('needs only a title and normalises the fields', () => {
    expect(createTaskRequestSchema.parse({ title: '  Buy milk ' })).toEqual({ title: 'Buy milk' });
    expect(
      createTaskRequestSchema.parse({ title: 'x', description: '  a\nb ', priority: 'HIGH', dueAt: '2026-10-12T09:00:00+07:00', projectId: uuid, assigneeId: uuid }),
    ).toEqual({ title: 'x', description: 'a\nb', priority: 'HIGH', dueAt: '2026-10-12T02:00:00.000Z', projectId: uuid, assigneeId: uuid });
  });

  it('accepts null for Inbox, no assignee and no deadline', () => {
    expect(createTaskRequestSchema.parse({ title: 'x', projectId: null, assigneeId: null, dueAt: null })).toEqual({
      title: 'x',
      projectId: null,
      assigneeId: null,
      dueAt: null,
    });
  });

  it('rejects server-owned fields, bad values and unknown fields', () => {
    for (const bad of [
      {},
      { title: ' ' },
      { title: 'x', status: 'DONE' },
      { title: 'x', position: '1' },
      { title: 'x', version: 1 },
      { title: 'x', createdById: uuid },
      { title: 'x', workspaceId: uuid },
      { title: 'x', priority: 'NOW' },
      { title: 'x', dueAt: '2026-10-12' },
      { title: 'x', projectId: 'inbox' },
    ]) {
      expect(createTaskRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('updateTaskRequestSchema', () => {
  it('requires the version and at least one change', () => {
    expect(updateTaskRequestSchema.parse({ version: 3, title: ' New ' })).toEqual({ version: 3, title: 'New' });
    expect(updateTaskRequestSchema.parse({ version: 1, description: '', dueAt: null })).toEqual({ version: 1, description: null, dueAt: null });
    expect(updateTaskRequestSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('leaves status, assignee, project and position to their own operations', () => {
    for (const field of [{ status: 'DONE' }, { assigneeId: uuid }, { projectId: uuid }, { position: '5' }, { deletedAt: null }, { createdById: uuid }]) {
      expect(updateTaskRequestSchema.safeParse({ version: 1, title: 'x', ...field }).success).toBe(false);
    }
    expect(updateTaskRequestSchema.safeParse({ version: 0, title: 'x' }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ version: 1.5, title: 'x' }).success).toBe(false);
  });
});

describe('listTasksQuerySchema', () => {
  it('has safe defaults', () => {
    expect(listTasksQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('parses filters from query strings', () => {
    expect(listTasksQuerySchema.parse({ projectId: 'inbox', status: 'TODO', assigneeId: 'unassigned', priority: 'LOW', q: ' milk ', limit: '10' })).toEqual({
      projectId: 'inbox',
      status: 'TODO',
      assigneeId: 'unassigned',
      priority: 'LOW',
      q: 'milk',
      limit: 10,
    });
    expect(listTasksQuerySchema.parse({ projectId: uuid, assigneeId: uuid }).projectId).toBe(uuid);
  });

  it('rejects unknown filters, bad values and out-of-range limits', () => {
    for (const bad of [{ deleted: 'true' }, { includeDeleted: '1' }, { status: 'NOPE' }, { projectId: 'x' }, { limit: '0' }, { limit: '101' }, { limit: 'abc' }, { cursor: '***' }, { q: 'x'.repeat(101) }]) {
      expect(listTasksQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});
