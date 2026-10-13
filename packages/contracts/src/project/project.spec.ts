import { describe, expect, it } from 'vitest';
import { createProjectRequestSchema, listProjectsQuerySchema, updateProjectRequestSchema } from './project.js';

describe('project contracts', () => {
  it('normalises name and description, and blank description becomes null', () => {
    const parsed = createProjectRequestSchema.parse({ name: '  Caf\u0065\u0301 ', description: '  line1\nline2  ' });
    expect(parsed).toEqual({ name: 'Caf\u00e9', description: 'line1\nline2' });
    expect(createProjectRequestSchema.parse({ name: 'x', description: '   ' }).description).toBeNull();
  });

  it('rejects bad names, descriptions, presentation values and extra fields', () => {
    for (const bad of [
      { name: '' },
      { name: 'a\nb' },
      { name: 'x'.repeat(81) },
      { name: 'x', description: 'a\u0000b' },
      { name: 'x', description: 'a\u202Eb' },
      { name: 'x', description: 'y'.repeat(2001) },
      { name: 'x', color: 'chartreuse' },
      { name: 'x', icon: 'skull' },
      { name: 'x', workspaceId: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11' },
      { name: 'x', archivedAt: null },
    ]) {
      expect(createProjectRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('allows partial updates that can clear optional fields, but not empty ones', () => {
    expect(updateProjectRequestSchema.parse({ color: null, icon: null, description: '' })).toEqual({ color: null, icon: null, description: null });
    expect(updateProjectRequestSchema.safeParse({}).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ name: 'x', id: 'y' }).success).toBe(false);
  });

  it('defaults the list filter to active and rejects unknown values', () => {
    expect(listProjectsQuerySchema.parse({})).toEqual({ status: 'active' });
    expect(listProjectsQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(listProjectsQuerySchema.safeParse({ status: 'all', x: 1 }).success).toBe(false);
  });
});
