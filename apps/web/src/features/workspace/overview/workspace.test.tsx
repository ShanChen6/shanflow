import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { canRename, loadWorkspace, renameWorkspace, validateWorkspaceName } from './workspace.action';
import { WorkspaceView } from './workspace-view';

const wsId = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
const userId = '1c2f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a22';
const now = '2026-10-12T00:00:00.000Z';
const workspace = { id: wsId, name: 'Personal', type: 'PERSONAL', role: 'OWNER', createdAt: now, updatedAt: now } as const;
const members = [{ userId, displayName: 'Ann', role: 'OWNER', joinedAt: now }];
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({
    accessToken: 'jwt',
    expiresAt: Date.now() + 600_000,
    user: { id: userId, email: 'a@example.invalid', displayName: 'Ann', emailVerified: true },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('workspace actions', () => {
  it('loads the first workspace and its members', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { workspaces: [workspace] })).mockResolvedValueOnce(reply(200, { members }));
    expect(await loadWorkspace()).toEqual({ status: 'ready', workspace, members });
    expect(fetchMock.mock.calls[1]![0]).toMatch(new RegExp(`/workspaces/${wsId}/members$`));
  });

  it('only owners and admins see rename', () => {
    expect(canRename({ role: 'OWNER' })).toBe(true);
    expect(canRename({ role: 'ADMIN' })).toBe(true);
    expect(canRename({ role: 'MEMBER' })).toBe(false);
  });

  it('validates the name like the API', () => {
    expect(validateWorkspaceName('Home')).toBeUndefined();
    for (const bad of ['', '   ', 'n'.repeat(81), 'a\nb']) expect(validateWorkspaceName(bad)).toEqual(expect.any(String));
  });

  it('sends only the name and maps failures', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { workspace: { ...workspace, name: 'Home' } }));
    expect((await renameWorkspace(workspace, 'Home')).status).toBe('renamed');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ name: 'Home' });
    expect(fetchMock.mock.calls[0]![1].method).toBe('PATCH');
    fetchMock.mockResolvedValueOnce(problem(403, 'FORBIDDEN'));
    expect(await renameWorkspace(workspace, 'Again')).toEqual({ status: 'error', formError: expect.stringContaining('permission') });
    expect(await renameWorkspace(workspace, '   ')).toEqual({ status: 'error', nameError: expect.any(String) });
  });
});

describe('WorkspaceView', () => {
  it('shows the workspace, members and renames it', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { workspaces: [workspace] }))
      .mockResolvedValueOnce(reply(200, { members }))
      .mockResolvedValueOnce(reply(200, { workspace: { ...workspace, name: 'Home' } }));
    render(<WorkspaceView />);
    expect(await screen.findByRole('heading', { name: 'Personal' })).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Home');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Name updated.')).toBeTruthy());
  });

  it('hides rename for a plain member', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { workspaces: [{ ...workspace, role: 'MEMBER' }] })).mockResolvedValueOnce(reply(200, { members }));
    render(<WorkspaceView />);
    await screen.findByRole('heading', { name: 'Personal' });
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('shows an error when loading fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<WorkspaceView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
