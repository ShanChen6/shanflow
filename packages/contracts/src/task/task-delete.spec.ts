import { describe, expect, it } from 'vitest';
import { deleteTaskQuerySchema } from './task-lifecycle.js';

describe('deleteTaskQuerySchema', () => {
  it('needs the current version, sent as a query string', () => {
    expect(deleteTaskQuerySchema.parse({ version: '3' })).toEqual({ version: 3 });
    expect(deleteTaskQuerySchema.parse({ version: 1 })).toEqual({ version: 1 });
  });

  it('rejects a missing, non-numeric or non-positive version and any other parameter', () => {
    for (const bad of [{}, { version: '' }, { version: 'abc' }, { version: '0' }, { version: '-1' }, { version: '1.5' }, { version: '1', hard: 'true' }, { version: '1', force: '1' }]) {
      expect(deleteTaskQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});
