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
import { ConfirmEmailHandler } from './confirm-email.handler.js';
import { RequestVerificationHandler } from './request-verification.handler.js';
import {
  confirmEmailRequestSchema,
  type ConfirmEmailRequest,
} from './verify-email.schema.js';

const HOUR_MS = 60 * 60 * 1000;

@Controller('auth/email-verification')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class VerifyEmailController {
  constructor(
    private readonly requestHandler: RequestVerificationHandler,
    private readonly confirmHandler: ConfirmEmailHandler,
  ) {}

  /** Authenticated, and limited per user (guard order matters: the tracker needs the principal). */
  @Post('request')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 3,
      ttl: HOUR_MS,
      getTracker: (request: Record<string, unknown>) =>
        `verify-request|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
    },
  })
  async request(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.requestHandler.execute(principal);
  }

  @Post('confirm')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  async confirm(
    @Body(new ZodValidationPipe(confirmEmailRequestSchema))
    body: ConfirmEmailRequest,
  ): Promise<void> {
    await this.confirmHandler.execute(body);
  }
}
