import { Injectable } from '@nestjs/common';
import type { ListMembersResponse } from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Principal } from '../../auth/shared/principal.js';
import { WorkspaceAccessService } from '../shared/workspace-access.service.js';

@Injectable()
export class ListMembersHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** ACTIVE members only, without email: members do not get each other's contact details. */
  async execute(
    principal: Principal,
    workspaceId: string,
  ): Promise<ListMembersResponse> {
    await this.access.require(principal.userId, workspaceId);
    const rows = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        membershipStatus: 'ACTIVE',
        user: { accountStatus: 'ACTIVE' },
      },
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: { select: { displayName: true } },
      },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    return {
      members: rows.map((row) => ({
        userId: row.userId,
        displayName: row.user.displayName,
        role: row.role,
        joinedAt: row.joinedAt.toISOString(),
      })),
    };
  }
}
