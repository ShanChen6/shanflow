import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  createTaskRequestSchema,
  listTasksQuerySchema,
  updateTaskRequestSchema,
  type UpdateTaskRequest,
  type ListTasksQuery,
  type ListTasksResponse,
  type CreateTaskRequest,
  type TaskResponse,
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
import { TaskHandlers } from './task.handlers.js';

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

@Controller('workspaces/:workspaceId/tasks')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class TaskController {
  constructor(private readonly tasks: TaskHandlers) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ListTasksResponse> {
    noStore(response);
    return this.tasks.list(principal, workspaceId, query);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(createTaskRequestSchema))
    body: CreateTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.tasks.create(principal, workspaceId, body);
  }

  @Get(':taskId')
  @UseGuards(JwtAuthGuard)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.tasks.get(principal, workspaceId, taskId);
  }

  @Patch(':taskId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @writeLimit
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(updateTaskRequestSchema))
    body: UpdateTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TaskResponse> {
    noStore(response);
    return this.tasks.update(principal, workspaceId, taskId, body);
  }
}
