import { describe, expect, it } from 'vitest';
import { changeTaskStatusRequestSchema } from './task-lifecycle.js';

describe('changeTaskStatusRequestSchema', () => {
  it('needs a known status and the current version', () => {
    expect(changeTaskStatusRequestSchema.parse({ status: 'DONE', version: 3 })).toEqual({ status: 'DONE', version: 3 });
    for (const status of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      expect(changeTaskStatusRequestSchema.safeParse({ status, version: 1 }).success).toBe(true);
    }
  });

  it('rejects a missing or unknown status, a bad version and any other field', () => {
    for (const bad of [
      {},
      { status: 'DONE' },
      { version: 1 },
      { status: 'BLOCKED', version: 1 },
      { status: 'done', version: 1 },
      { status: 'DONE', version: 0 },
      { status: 'DONE', version: '1' },
      { status: 'DONE', version: 1.5 },
      { status: 'DONE', version: 1, completedAt: '2026-10-12T00:00:00Z' },
      { status: 'DONE', version: 1, position: '5' },
      { status: 'DONE', version: 1, title: 'x' },
    ]) {
      expect(changeTaskStatusRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});
