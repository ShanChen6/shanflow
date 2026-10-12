import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  assignTaskRequestSchema,
  changeTaskStatusRequestSchema,
  deleteTaskQuerySchema,
  listTrashQuerySchema,
  restoreTaskRequestSchema,
  type AssignTaskRequest,
  type ChangeTaskStatusRequest,
  type DeleteTaskQuery,
  type ListTrashQuery,
  type RestoreTaskRequest,
  type TrashResponse,
  type TaskResponse,
} from '@shanflow/contracts';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../auth/shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../../auth/shared/jwt-auth.guard.js';
import type {
  AuthenticatedRequest,
  Principal,
} from '../../auth/shared/principal.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { LifecycleHandlers } from './lifecycle.handlers.js';

const noStore = (response: Response) =>
  response.setHeader('Cache-Control', 'private, no-store');

/** Per-user write limit; authenticate first (guard order) so the counter is per user, not per IP. */
const writeLimit = Throttle({
  default: {
    limit: 60,
    ttl: 60_000,
    getTracker: (request: Record<string, unknown>) =>
      `task-write|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
  },
});

@Controller('workspaces/:workspaceId/tasks/:taskId')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleHandlers) {}

  @Post('status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  changeStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(changeTaskStatusRequestSchema))
    body: ChangeTaskStatusRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.lifecycle.changeStatus(principal, workspaceId, taskId, body);
  }

  @Put('assignee')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  assign(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(assignTaskRequestSchema))
    body: AssignTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.lifecycle.assign(principal, workspaceId, taskId, body);
  }

  @Delete()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Query(new ZodValidationPipe(deleteTaskQuerySchema)) query: DeleteTaskQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.lifecycle.remove(principal, workspaceId, taskId, query);
  }

  @Post('restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  restore(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(restoreTaskRequestSchema))
    body: RestoreTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.lifecycle.restore(principal, workspaceId, taskId, body);
  }
}

/** The trash is its own path, so no list filter can ever mix tombstones with live tasks. */
@Controller('workspaces/:workspaceId/task-trash')
@UseFilters(ProblemDetailsFilter)
@SkipThrottle({ 'login-email': true })
export class TrashController {
  constructor(private readonly lifecycle: LifecycleHandlers) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Query(new ZodValidationPipe(listTrashQuerySchema)) query: ListTrashQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrashResponse> {
    noStore(response);
    return this.lifecycle.listTrash(principal, workspaceId, query);
  }
}
