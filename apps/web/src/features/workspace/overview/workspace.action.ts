import {
  AUTH_ERROR_CODES,
  WORKSPACE_MANAGER_ROLES,
  listMembersResponseSchema,
  listWorkspacesResponseSchema,
  updateWorkspaceRequestSchema,
  updateWorkspaceResponseSchema,
  workspaceNameSchema,
  type Workspace,
  type WorkspaceMember,
} from '@shanflow/contracts';
import { authedGetJson, authedPatchJson } from '@/features/auth/shared/auth-client';

export type WorkspaceLoad = { status: 'ready'; workspace: Workspace; members: WorkspaceMember[] } | { status: 'error' } | { status: 'signed-out' };

/** Loads my workspace (the MVP has one personal workspace per account) and its members. */
export async function loadWorkspace(): Promise<WorkspaceLoad> {
  const list = await authedGetJson('/workspaces', listWorkspacesResponseSchema);
  if (!list.ok) return list.kind === 'signed-out' ? { status: 'signed-out' } : { status: 'error' };
  const workspace = list.data.workspaces[0];
  if (!workspace) return { status: 'error' };
  const members = await authedGetJson(`/workspaces/${workspace.id}/members`, listMembersResponseSchema);
  if (!members.ok) return members.kind === 'signed-out' ? { status: 'signed-out' } : { status: 'error' };
  return { status: 'ready', workspace, members: members.data.members };
}

/** The server decides; this only hides controls the caller cannot use. */
export function canRename(workspace: Pick<Workspace, 'role'>): boolean {
  return (WORKSPACE_MANAGER_ROLES as readonly string[]).includes(workspace.role);
}

const NAME_MESSAGE = 'Enter a name of 1 to 80 characters, without line breaks or hidden characters.';

export function validateWorkspaceName(value: string): string | undefined {
  return workspaceNameSchema.safeParse(value).success ? undefined : NAME_MESSAGE;
}

export type RenameOutcome =
  | { status: 'renamed'; workspace: Workspace }
  | { status: 'error'; nameError?: string; formError?: string }
  | { status: 'signed-out' };

export async function renameWorkspace(workspace: Workspace, name: string): Promise<RenameOutcome> {
  const nameError = validateWorkspaceName(name);
  if (nameError) return { status: 'error', nameError };
  const body = updateWorkspaceRequestSchema.parse({ name });
  const result = await authedPatchJson(`/workspaces/${workspace.id}`, body, updateWorkspaceResponseSchema);
  if (result.ok) return { status: 'renamed', workspace: result.data.workspace };
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  if (result.kind === 'problem') {
    switch (result.problem.code) {
      case AUTH_ERROR_CODES.validationFailed:
        return { status: 'error', nameError: NAME_MESSAGE };
      case AUTH_ERROR_CODES.forbidden:
        return { status: 'error', formError: 'You do not have permission to rename this workspace.' };
      case AUTH_ERROR_CODES.notFound:
        return { status: 'error', formError: 'This workspace is no longer available to you.' };
      case AUTH_ERROR_CODES.tooManyRequests:
        return { status: 'error', formError: 'Too many changes. Please wait a moment and try again.' };
      case AUTH_ERROR_CODES.unauthenticated:
        return { status: 'signed-out' };
    }
  }
  return { status: 'error', formError: 'Could not save the name. Check your connection and try again.' };
}
