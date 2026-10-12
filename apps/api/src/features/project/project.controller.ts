import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  createProjectRequestSchema,
  listProjectsQuerySchema,
  updateProjectRequestSchema,
  type CreateProjectRequest,
  type ListProjectsQuery,
  type ListProjectsResponse,
  type ProjectResponse,
  type UpdateProjectRequest,
} from '@shanflow/contracts';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../auth/shared/jwt-auth.guard.js';
import type {
  AuthenticatedRequest,
  Principal,
} from '../auth/shared/principal.js';
import { ProblemDetailsFilter } from '../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe.js';
import { ProjectHandlers } from './project.handlers.js';

const noStore = (response: Response) =>
  response.setHeader('Cache-Control', 'private, no-store');

/** Per-user write limit; authenticate first (guard order) so the counter is per user, not per IP. */
const writeLimit = Throttle({
  default: {
    limit: 30,
    ttl: 60_000,
    getTracker: (request: Record<string, unknown>) =>
      `project-write|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
  },
});

@Controller('workspaces/:workspaceId/projects')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class ProjectController {
  constructor(private readonly projects: ProjectHandlers) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Query(new ZodValidationPipe(listProjectsQuerySchema))
    query: ListProjectsQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ListProjectsResponse> {
    noStore(response);
    return this.projects.list(principal, workspaceId, query);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(createProjectRequestSchema))
    body: CreateProjectRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    noStore(response);
    return this.projects.create(principal, workspaceId, body);
  }

  @Get(':projectId')
  @UseGuards(JwtAuthGuard)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    noStore(response);
    return this.projects.get(principal, workspaceId, projectId);
  }

  @Patch(':projectId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(updateProjectRequestSchema))
    body: UpdateProjectRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    noStore(response);
    return this.projects.update(principal, workspaceId, projectId, body);
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  archive(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    noStore(response);
    return this.projects.archive(principal, workspaceId, projectId);
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  restore(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    noStore(response);
    return this.projects.restore(principal, workspaceId, projectId);
  }
}
