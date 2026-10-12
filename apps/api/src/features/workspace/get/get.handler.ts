import { Injectable } from '@nestjs/common';
import type { GetWorkspaceResponse } from '@shanflow/contracts';
import type { Principal } from '../../auth/shared/principal.js';
import { WorkspaceAccessService } from '../shared/workspace-access.service.js';
import { toWorkspace } from '../shared/workspace.mapper.js';

@Injectable()
export class GetWorkspaceHandler {
  constructor(private readonly access: WorkspaceAccessService) {}

  async execute(
    principal: Principal,
    workspaceId: string,
  ): Promise<GetWorkspaceResponse> {
    return {
      workspace: toWorkspace(
        await this.access.require(principal.userId, workspaceId),
      ),
    };
  }
}
