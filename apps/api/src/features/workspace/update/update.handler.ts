import { Injectable } from '@nestjs/common';
import {
  WORKSPACE_MANAGER_ROLES,
  type UpdateWorkspaceRequest,
  type UpdateWorkspaceResponse,
} from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Principal } from '../../auth/shared/principal.js';
import { WorkspaceAccessService } from '../shared/workspace-access.service.js';
import { toWorkspace } from '../shared/workspace.mapper.js';

@Injectable()
export class UpdateWorkspaceHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Only the name changes. The permission check and the write share one transaction, with the membership share-locked. */
  async execute(
    principal: Principal,
    workspaceId: string,
    request: UpdateWorkspaceRequest,
  ): Promise<UpdateWorkspaceResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { role } = await this.access.require(
        principal.userId,
        workspaceId,
        { roles: WORKSPACE_MANAGER_ROLES, lock: true },
        tx,
      );
      const updated = await tx.workspace.update({
        where: { id: workspaceId },
        data: { name: request.name },
        select: {
          id: true,
          name: true,
          type: true,
          ownerId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return { workspace: toWorkspace({ workspace: updated, role }) };
    });
  }
}
