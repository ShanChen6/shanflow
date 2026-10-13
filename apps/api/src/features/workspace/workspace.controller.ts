import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  updateWorkspaceRequestSchema,
  type GetWorkspaceResponse,
  type ListMembersResponse,
  type ListWorkspacesResponse,
  type UpdateWorkspaceRequest,
  type UpdateWorkspaceResponse,
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
import { GetWorkspaceHandler } from './get/get.handler.js';
import { ListWorkspacesHandler } from './list/list.handler.js';
import { ListMembersHandler } from './members/members.handler.js';
import { UpdateWorkspaceHandler } from './update/update.handler.js';

const noStore = (response: Response) =>
  response.setHeader('Cache-Control', 'private, no-store');

@Controller('workspaces')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class WorkspaceController {
  constructor(
    private readonly list: ListWorkspacesHandler,
    private readonly get: GetWorkspaceHandler,
    private readonly update: UpdateWorkspaceHandler,
    private readonly members: ListMembersHandler,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  listWorkspaces(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ListWorkspacesResponse> {
    noStore(response);
    return this.list.execute(principal);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getWorkspace(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GetWorkspaceResponse> {
    noStore(response);
    return this.get.execute(principal, id);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  listMembers(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ListMembersResponse> {
    noStore(response);
    return this.members.execute(principal, id);
  }

  /** Guard order matters: authenticate first so the throttle can be counted per user. */
  @Patch(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 20,
      ttl: 60_000,
      getTracker: (request: Record<string, unknown>) =>
        `update-workspace|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
    },
  })
  updateWorkspace(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkspaceRequestSchema))
    body: UpdateWorkspaceRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UpdateWorkspaceResponse> {
    noStore(response);
    return this.update.execute(principal, id, body);
  }
}
