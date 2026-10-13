import type { Project } from '@shanflow/contracts';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { canManage, createProject, loadProjects, setArchived, updateProject, validateProjectName } from './project.action';
import { ProjectsView } from './projects-view';

const wsId = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
const projectId = '2d3f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a33';
const now = '2026-10-12T00:00:00.000Z';
const workspace = { id: wsId, name: 'Personal', type: 'PERSONAL', role: 'OWNER', createdAt: now, updatedAt: now } as const;
const project: Project = {
  id: projectId,
  workspaceId: wsId,
  name: 'Website',
  description: 'Redesign',
  color: 'blue',
  icon: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user: { id: wsId, email: 'a@example.invalid', displayName: 'A', emailVerified: true } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('project actions', () => {
  it('loads the workspace then its projects with the status filter', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { workspaces: [workspace] })).mockResolvedValueOnce(reply(200, { projects: [project] }));
    expect(await loadProjects('archived')).toEqual({ status: 'ready', workspace, projects: [project] });
    expect(fetchMock.mock.calls[1]![0]).toMatch(new RegExp(`/workspaces/${wsId}/projects\\?status=archived$`));
  });

  it('shows management controls only to owners and admins', () => {
    expect(canManage({ role: 'OWNER' })).toBe(true);
    expect(canManage({ role: 'ADMIN' })).toBe(true);
    expect(canManage({ role: 'MEMBER' })).toBe(false);
  });

  it('validates names like the API', () => {
    expect(validateProjectName('Site')).toBeUndefined();
    for (const bad of ['', '  ', 'x'.repeat(81), 'a\nb']) expect(validateProjectName(bad)).toEqual(expect.any(String));
  });

  it('creates with only contract fields and maps failures', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { project }));
    expect(await createProject(workspace, { name: 'Website', color: 'blue' })).toEqual({ status: 'ok', project });
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ name: 'Website', color: 'blue' });
    fetchMock.mockResolvedValueOnce(problem(409, 'PROJECT_LIMIT_REACHED'));
    expect(await createProject(workspace, { name: 'Another' })).toEqual({ status: 'error', formError: expect.stringContaining('limit') });
    expect(await createProject(workspace, { name: '  ' })).toEqual({ status: 'error', nameError: expect.any(String) });
  });

  it('updates, archives and restores through the project routes', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { project: { ...project, name: 'New' } }));
    expect((await updateProject(project, { name: 'New' })).status).toBe('ok');
    expect(fetchMock.mock.calls[0]![1].method).toBe('PATCH');
    fetchMock.mockResolvedValueOnce(reply(200, { project: { ...project, archivedAt: now } }));
    await setArchived(project, true);
    expect(fetchMock.mock.calls[1]![0]).toMatch(/\/projects\/[^/]+\/archive$/);
    fetchMock.mockResolvedValueOnce(problem(409, 'PROJECT_ARCHIVED'));
    expect(await updateProject(project, { name: 'Again' })).toEqual({ status: 'error', formError: expect.stringContaining('archived') });
  });
});

describe('ProjectsView', () => {
  it('lists projects, creates one, and archives one (it leaves the active list)', async () => {
    const created = { ...project, id: '3e4f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a44', name: 'Mobile', description: null, color: null };
    fetchMock
      .mockResolvedValueOnce(reply(200, { workspaces: [workspace] }))
      .mockResolvedValueOnce(reply(200, { projects: [project] }))
      .mockResolvedValueOnce(reply(201, { project: created }))
      .mockResolvedValueOnce(reply(200, { project: { ...project, archivedAt: now } }));
    render(<ProjectsView />);
    expect(await screen.findByText('Website')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Name'), 'Mobile');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Mobile')).toBeTruthy();

    const row = screen.getByText('Website').closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByText('Website')).toBeNull());
    expect(screen.getByText('Mobile')).toBeTruthy();
  });

  it('hides management controls from a plain member', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { workspaces: [{ ...workspace, role: 'MEMBER' }] })).mockResolvedValueOnce(reply(200, { projects: [project] }));
    render(<ProjectsView />);
    await screen.findByText('Website');
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
  });

  it('switches to the archived list', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { workspaces: [workspace] }))
      .mockResolvedValueOnce(reply(200, { projects: [] }))
      .mockResolvedValueOnce(reply(200, { projects: [{ ...project, archivedAt: now }] }));
    render(<ProjectsView />);
    await screen.findByText('No projects yet.');
    await userEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText('Website')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows an error when loading fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<ProjectsView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
