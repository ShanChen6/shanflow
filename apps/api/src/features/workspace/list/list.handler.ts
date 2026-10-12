import { Injectable } from '@nestjs/common';
import type { ListWorkspacesResponse } from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import type { Principal } from '../../auth/shared/principal.js';
import { PersonalWorkspaceService } from '../shared/personal-workspace.service.js';

@Injectable()
export class ListWorkspacesHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly personal: PersonalWorkspaceService,
  ) {}

  private memberships(userId: string) {
    return this.prisma.workspaceMember.findMany({
      where: {
        userId,
        membershipStatus: 'ACTIVE',
        user: { accountStatus: 'ACTIVE' },
      },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            type: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async execute(principal: Principal): Promise<ListWorkspacesResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { accountStatus: true },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();

    let rows = await this.memberships(principal.userId);
    if (rows.length === 0) {
      // An account created before workspaces existed: give it the personal workspace every account has.
      await this.personal.ensure(principal.userId);
      rows = await this.memberships(principal.userId);
    }
    return {
      workspaces: rows.map(({ role, workspace }) => ({
        id: workspace.id,
        name: workspace.name,
        type: workspace.type,
        role,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      })),
    };
  }
}
