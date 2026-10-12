import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  changeTaskStatusRequestSchema,
  type ChangeTaskStatusRequest,
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
}
