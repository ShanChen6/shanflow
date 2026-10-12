import { describe, expect, it } from 'vitest';
import { listMembersResponseSchema, updateWorkspaceRequestSchema, workspaceSchema } from './workspace.js';

const id = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
const now = '2026-10-12T00:00:00.000Z';

describe('workspace contracts', () => {
  it('accepts a valid workspace and member list', () => {
    expect(workspaceSchema.safeParse({ id, name: 'Personal', type: 'PERSONAL', role: 'OWNER', createdAt: now, updatedAt: now }).success).toBe(true);
    expect(listMembersResponseSchema.safeParse({ members: [{ userId: id, displayName: 'Ann', role: 'MEMBER', joinedAt: now }] }).success).toBe(true);
  });

  it('trims and normalises the new name', () => {
    expect(updateWorkspaceRequestSchema.parse({ name: '  Café  ' }).name).toBe('Café');
  });

  it('rejects blank, long, hidden-character and extra fields', () => {
    for (const bad of [{ name: '   ' }, { name: 'n'.repeat(81) }, { name: 'a\nb' }, { name: 'a‮b' }, { name: 'x', ownerId: id }, { name: 'x', type: 'TEAM' }, {}]) {
      expect(updateWorkspaceRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('does not expose email on members', () => {
    const parsed = listMembersResponseSchema.parse({ members: [{ userId: id, displayName: 'Ann', role: 'OWNER', joinedAt: now, email: 'a@b.c' }] });
    expect(parsed.members[0]).not.toHaveProperty('email');
  });
});
