import { Injectable } from '@nestjs/common';
import {
  MAX_PROJECTS_PER_WORKSPACE,
  WORKSPACE_MANAGER_ROLES,
  type CreateProjectRequest,
  type ListProjectsQuery,
  type ListProjectsResponse,
  type Project,
  type ProjectResponse,
  type UpdateProjectRequest,
} from '@shanflow/contracts';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service.js';
import type { Principal } from '../auth/shared/principal.js';
import type { Tx } from '../auth/shared/transaction.js';
import { WorkspaceAccessService } from '../workspace/shared/workspace-access.service.js';
import {
  ProjectArchivedError,
  ProjectLimitReachedError,
  ProjectNotFoundError,
} from './project.errors.js';

const PROJECT_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  color: true,
  icon: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface StoredProject {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toProject(row: StoredProject): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    // Values are written only through the contract's allowlist.
    color: row.color as Project['color'],
    icon: row.icon as Project['icon'],
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

@Injectable()
export class ProjectHandlers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Projects are always looked up by (workspace, id): another workspace's project is simply not found. */
  private async find(
    tx: Tx | PrismaService,
    workspaceId: string,
    projectId: string,
  ) {
    if (!isUuid(projectId)) throw new ProjectNotFoundError();
    const row = await tx.project.findFirst({
      where: { id: projectId, workspaceId },
      select: PROJECT_SELECT,
    });
    if (!row) throw new ProjectNotFoundError();
    return row;
  }

  /** Runs `work` after a manager-only permission check, in one transaction with the membership share-locked. */
  private manage<T>(
    principal: Principal,
    workspaceId: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await this.access.require(
        principal.userId,
        workspaceId,
        { roles: WORKSPACE_MANAGER_ROLES, lock: true },
        tx,
      );
      return work(tx);
    });
  }

  async list(
    principal: Principal,
    workspaceId: string,
    query: ListProjectsQuery,
  ): Promise<ListProjectsResponse> {
    await this.access.require(principal.userId, workspaceId);
    const rows = await this.prisma.project.findMany({
      where: {
        workspaceId,
        ...(query.status === 'active' && { archivedAt: null }),
        ...(query.status === 'archived' && { archivedAt: { not: null } }),
      },
      select: PROJECT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_PROJECTS_PER_WORKSPACE,
    });
    return { projects: rows.map(toProject) };
  }

  async get(
    principal: Principal,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectResponse> {
    await this.access.require(principal.userId, workspaceId);
    return {
      project: toProject(await this.find(this.prisma, workspaceId, projectId)),
    };
  }

  create(
    principal: Principal,
    workspaceId: string,
    request: CreateProjectRequest,
  ): Promise<ProjectResponse> {
    return this.manage(principal, workspaceId, async (tx) => {
      // Serialises concurrent creations so the limit cannot be exceeded.
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      if (
        (await tx.project.count({ where: { workspaceId } })) >=
        MAX_PROJECTS_PER_WORKSPACE
      )
        throw new ProjectLimitReachedError();
      const row = await tx.project.create({
        data: {
          workspaceId,
          name: request.name,
          description: request.description ?? null,
          color: request.color ?? null,
          icon: request.icon ?? null,
        },
        select: PROJECT_SELECT,
      });
      return { project: toProject(row) };
    });
  }

  update(
    principal: Principal,
    workspaceId: string,
    projectId: string,
    changes: UpdateProjectRequest,
  ): Promise<ProjectResponse> {
    return this.manage(principal, workspaceId, async (tx) => {
      const current = await this.find(tx, workspaceId, projectId);
      if (current.archivedAt) throw new ProjectArchivedError();
      const row = await tx.project.update({
        where: { id: projectId },
        data: changes,
        select: PROJECT_SELECT,
      });
      return { project: toProject(row) };
    });
  }

  /** Idempotent: archiving an archived project returns it unchanged (its archive time is not rewritten). */
  archive(
    principal: Principal,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectResponse> {
    return this.setArchived(principal, workspaceId, projectId, true);
  }

  restore(
    principal: Principal,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectResponse> {
    return this.setArchived(principal, workspaceId, projectId, false);
  }

  private setArchived(
    principal: Principal,
    workspaceId: string,
    projectId: string,
    archived: boolean,
  ): Promise<ProjectResponse> {
    return this.manage(principal, workspaceId, async (tx) => {
      await this.find(tx, workspaceId, projectId);
      // Atomic: only a project in the opposite state changes; the other call is a no-op.
      await tx.project.updateMany({
        where: {
          id: projectId,
          workspaceId,
          archivedAt: archived ? null : { not: null },
        },
        data: { archivedAt: archived ? new Date() : null },
      });
      return {
        project: toProject(await this.find(tx, workspaceId, projectId)),
      };
    });
  }
}
