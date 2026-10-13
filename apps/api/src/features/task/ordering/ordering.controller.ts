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
  moveTaskRequestSchema,
  type MoveTaskRequest,
  type MoveTaskResponse,
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
import { OrderingHandlers } from './ordering.handlers.js';

/** Dragging produces bursts of moves, so the limit is higher than for other writes; still counted per user. */
const moveLimit = Throttle({
  default: {
    limit: 120,
    ttl: 60_000,
    getTracker: (request: Record<string, unknown>) =>
      `task-move|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
  },
});

@Controller('workspaces/:workspaceId/tasks/:taskId')
@UseFilters(ProblemDetailsFilter)
@SkipThrottle({ 'login-email': true })
export class OrderingController {
  constructor(private readonly ordering: OrderingHandlers) {}

  @Post('move')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @moveLimit
  move(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(moveTaskRequestSchema)) body: MoveTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MoveTaskResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.ordering.move(principal, workspaceId, taskId, body);
  }
}
