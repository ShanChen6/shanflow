import { describe, expect, it } from 'vitest';
import { assignTaskRequestSchema } from './task-lifecycle.js';

const id = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';

describe('assignTaskRequestSchema', () => {
  it('sets an assignee, or clears it with null, together with the version', () => {
    expect(assignTaskRequestSchema.parse({ assigneeId: id, version: 2 })).toEqual({ assigneeId: id, version: 2 });
    expect(assignTaskRequestSchema.parse({ assigneeId: null, version: 1 })).toEqual({ assigneeId: null, version: 1 });
  });

  it('insists on saying who (or nobody): an omitted assigneeId is not a way to clear', () => {
    expect(assignTaskRequestSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('rejects anything that is not a user id, a bad version and every other field', () => {
    for (const bad of [
      { assigneeId: 'me', version: 1 },
      { assigneeId: '', version: 1 },
      { assigneeId: 'unassigned', version: 1 },
      { assigneeId: 5, version: 1 },
      { assigneeId: id },
      { assigneeId: id, version: 0 },
      { assigneeId: id, version: '1' },
      { assigneeId: id, version: 1, status: 'DONE' },
      { assigneeId: id, version: 1, createdById: id },
    ]) {
      expect(assignTaskRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});
