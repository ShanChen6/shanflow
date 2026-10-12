import type { Workspace } from '@shanflow/contracts';
import type { WorkspaceAccess } from './workspace-access.service.js';

export function toWorkspace({ workspace, role }: WorkspaceAccess): Workspace {
  return {
    id: workspace.id,
    name: workspace.name,
    type: workspace.type,
    role,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}
