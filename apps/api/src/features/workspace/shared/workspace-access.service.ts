import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { WorkspaceRole } from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { Tx } from '../../auth/shared/transaction.js';
import { ForbiddenError, WorkspaceNotFoundError } from './workspace.errors.js';

export interface WorkspaceAccess {
  workspace: {
    id: string;
    name: string;
    type: 'PERSONAL' | 'TEAM';
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  };
  /** The caller's own role in the workspace. */
  role: WorkspaceRole;
}

interface AccessRow {
  role: WorkspaceRole;
  id: string;
  name: string;
  type: 'PERSONAL' | 'TEAM';
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface RequireOptions {
  /** Roles allowed to proceed; omitted means any ACTIVE member. */
  roles?: readonly WorkspaceRole[];
  /** Share-lock the membership row until the transaction ends, so a concurrent demotion cannot slip in before the write. */
  lock?: boolean;
}

/**
 * The one place that decides what a user may do in a workspace. The actor is always the id from the access
 * token; role and status are read from the database on every call, so revoking access takes effect at once.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the caller's access, or throws. Not a member / membership INACTIVE / account not ACTIVE / unknown or
   * malformed id are all the same 404; a member with an insufficient role gets 403.
   */
  async require(
    userId: string,
    workspaceId: string,
    options: RequireOptions = {},
    client: PrismaService | Tx = this.prisma,
  ): Promise<WorkspaceAccess> {
    if (!z.uuid().safeParse(workspaceId).success)
      throw new WorkspaceNotFoundError();
    const lock = options.lock ? Prisma.sql`FOR SHARE OF m` : Prisma.empty;
    const rows = await client.$queryRaw<AccessRow[]>`
      SELECT m.role::text AS role, w.id, w.name, w.type::text AS type, w.owner_id, w.created_at, w.updated_at
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ${workspaceId}::uuid
        AND m.user_id = ${userId}::uuid
        AND m.membership_status = 'ACTIVE'
        AND u.account_status = 'ACTIVE'
      ${lock}`;
    const row = rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    if (options.roles && !options.roles.includes(row.role))
      throw new ForbiddenError();
    return {
      role: row.role,
      workspace: {
        id: row.id,
        name: row.name,
        type: row.type,
        ownerId: row.owner_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }
}
