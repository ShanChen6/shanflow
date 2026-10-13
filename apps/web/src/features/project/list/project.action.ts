import {
  AUTH_ERROR_CODES,
  createProjectRequestSchema,
  listProjectsResponseSchema,
  listWorkspacesResponseSchema,
  projectNameSchema,
  projectResponseSchema,
  updateProjectRequestSchema,
  WORKSPACE_MANAGER_ROLES,
  type CreateProjectRequest,
  type Project,
  type UpdateProjectRequest,
  type Workspace,
} from '@shanflow/contracts';
import { authedGetJson, authedPatchJson, authedPostJson } from '@/features/auth/shared/auth-client';

export type StatusFilter = 'active' | 'archived';
export type ProjectsLoad = { status: 'ready'; workspace: Workspace; projects: Project[] } | { status: 'error' } | { status: 'signed-out' };
export type ProjectOutcome = { status: 'ok'; project: Project } | { status: 'error'; nameError?: string; formError?: string } | { status: 'signed-out' };

const NAME_MESSAGE = 'Enter a name of 1 to 80 characters, without line breaks or hidden characters.';

export const canManage = (workspace: Pick<Workspace, 'role'>) => (WORKSPACE_MANAGER_ROLES as readonly string[]).includes(workspace.role);
export const validateProjectName = (value: string) => (projectNameSchema.safeParse(value).success ? undefined : NAME_MESSAGE);

/** Loads my workspace (one personal workspace per account in the MVP) and its projects for the chosen filter. */
export async function loadProjects(filter: StatusFilter, known?: Workspace): Promise<ProjectsLoad> {
  let workspace = known;
  if (!workspace) {
    const list = await authedGetJson('/workspaces', listWorkspacesResponseSchema);
    if (!list.ok) return list.kind === 'signed-out' ? { status: 'signed-out' } : { status: 'error' };
    workspace = list.data.workspaces[0];
    if (!workspace) return { status: 'error' };
  }
  const projects = await authedGetJson(`/workspaces/${workspace.id}/projects?status=${filter}`, listProjectsResponseSchema);
  if (!projects.ok) return projects.kind === 'signed-out' ? { status: 'signed-out' } : { status: 'error' };
  return { status: 'ready', workspace, projects: projects.data.projects };
}

type Failed = { ok: false; kind: string; problem?: { code?: string } };

function failure(result: Failed, fallback: string): ProjectOutcome {
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  switch (result.kind === 'problem' ? result.problem?.code : undefined) {
    case AUTH_ERROR_CODES.unauthenticated:
      return { status: 'signed-out' };
    case AUTH_ERROR_CODES.validationFailed:
      return { status: 'error', nameError: NAME_MESSAGE };
    case AUTH_ERROR_CODES.forbidden:
      return { status: 'error', formError: 'You do not have permission to do that.' };
    case AUTH_ERROR_CODES.notFound:
      return { status: 'error', formError: 'This project is no longer available.' };
    case AUTH_ERROR_CODES.projectArchived:
      return { status: 'error', formError: 'This project is archived. Restore it before changing it.' };
    case AUTH_ERROR_CODES.projectLimitReached:
      return { status: 'error', formError: 'This workspace has reached its project limit.' };
    case AUTH_ERROR_CODES.tooManyRequests:
      return { status: 'error', formError: 'Too many changes. Please wait a moment and try again.' };
  }
  return { status: 'error', formError: fallback };
}

export async function createProject(workspace: Workspace, input: CreateProjectRequest): Promise<ProjectOutcome> {
  const nameError = validateProjectName(input.name);
  if (nameError) return { status: 'error', nameError };
  const body = createProjectRequestSchema.safeParse(input);
  if (!body.success) return { status: 'error', formError: 'Those details are not valid.' };
  const result = await authedPostJson(`/workspaces/${workspace.id}/projects`, body.data, projectResponseSchema);
  return result.ok
    ? { status: 'ok', project: result.data.project }
    : failure(result as never, 'Could not create the project. Check your connection and try again.');
}

export async function updateProject(project: Project, changes: UpdateProjectRequest): Promise<ProjectOutcome> {
  if (changes.name !== undefined) {
    const nameError = validateProjectName(changes.name);
    if (nameError) return { status: 'error', nameError };
  }
  const body = updateProjectRequestSchema.safeParse(changes);
  if (!body.success) return { status: 'error', formError: 'Those details are not valid.' };
  const result = await authedPatchJson(`/workspaces/${project.workspaceId}/projects/${project.id}`, body.data, projectResponseSchema);
  return result.ok
    ? { status: 'ok', project: result.data.project }
    : failure(result as never, 'Could not save the project. Check your connection and try again.');
}

export async function setArchived(project: Project, archived: boolean): Promise<ProjectOutcome> {
  const result = await authedPostJson(
    `/workspaces/${project.workspaceId}/projects/${project.id}/${archived ? 'archive' : 'restore'}`,
    undefined,
    projectResponseSchema,
  );
  return result.ok
    ? { status: 'ok', project: result.data.project }
    : failure(result as never, 'Could not change the project. Check your connection and try again.');
}
