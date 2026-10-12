import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { CurrentPrincipal } from '../shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import type { AuthenticatedRequest, Principal } from '../shared/principal.js';
import { SensitiveSessionGuard } from '../shared/sensitive-session.guard.js';
import { ChangePasswordHandler } from './change-password.handler.js';
import {
  changePasswordRequestSchema,
  type ChangePasswordRequest,
} from './change-password.schema.js';

@Controller('auth/password')
@UseFilters(ProblemDetailsFilter)
@SkipThrottle({ 'login-email': true })
export class ChangePasswordController {
  constructor(private readonly handler: ChangePasswordHandler) {}

  /**
   * Guard order matters: authenticate, confirm the session is live, then throttle per user (the tracker
   * needs the principal). 5 attempts per 15 minutes bounds guessing of the current password by a token holder.
   */
  @Post('change')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, SensitiveSessionGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: 15 * 60 * 1000,
      getTracker: (request: Record<string, unknown>) =>
        `change-password|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
    },
  })
  async change(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    body: ChangePasswordRequest,
  ): Promise<void> {
    await this.handler.execute(principal, body);
  }
}
