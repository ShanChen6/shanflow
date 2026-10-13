import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../auth/shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../../auth/shared/jwt-auth.guard.js';
import type {
  AuthenticatedRequest,
  Principal,
} from '../../auth/shared/principal.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { UpdateProfileHandler } from './update-profile.handler.js';
import {
  updateProfileRequestSchema,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
} from './update-profile.schema.js';

@Controller('users')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; this route uses only 'default'.
@SkipThrottle({ 'login-email': true })
export class UpdateProfileController {
  constructor(private readonly handler: UpdateProfileHandler) {}

  /** Guard order matters: authenticate first so the throttle can be counted per user. */
  @Patch('me')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 20,
      ttl: 60_000,
      getTracker: (request: Record<string, unknown>) =>
        `update-profile|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
    },
  })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateProfileRequestSchema))
    body: UpdateProfileRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UpdateProfileResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.handler.execute(principal, body);
  }
}
