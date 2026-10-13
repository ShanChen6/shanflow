import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Tx } from '../../auth/shared/transaction.js';

export const PERSONAL_WORKSPACE_NAME = 'Personal';

/**
 * Guarantees that a user has exactly one PERSONAL workspace with a matching ACTIVE OWNER membership (ADR-005/011).
 * The schema only guarantees "at most one" (partial unique indexes); "exactly one and consistent" is this service's job.
 */
@Injectable()
export class PersonalWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent and safe under concurrency. Pass the caller's `tx` to make it part of a larger transaction (signup),
   * so a user can never be committed without its workspace.
   */
  async ensure(userId: string, tx?: Tx): Promise<{ workspaceId: string }> {
    if (!tx)
      return this.prisma.$transaction((inner) => this.ensure(userId, inner));

    // Serialises concurrent calls for the same user; the first creates, the others see its result.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

    const existing = await tx.workspace.findFirst({
      where: { ownerId: userId, type: 'PERSONAL' },
      select: { id: true },
    });
    if (existing) {
      // Repair rather than assume: the owner must hold an ACTIVE OWNER membership.
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: existing.id, userId },
        },
        create: { workspaceId: existing.id, userId, role: 'OWNER' },
        update: { role: 'OWNER', membershipStatus: 'ACTIVE' },
      });
      return { workspaceId: existing.id };
    }

    const workspace = await tx.workspace.create({
      data: {
        name: PERSONAL_WORKSPACE_NAME,
        type: 'PERSONAL',
        ownerId: userId,
        members: {
          create: { userId, role: 'OWNER', membershipStatus: 'ACTIVE' },
        },
      },
      select: { id: true },
    });
    return { workspaceId: workspace.id };
  }
}
