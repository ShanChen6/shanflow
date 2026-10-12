import {
  Body,
  Controller,
  Get,
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
import { SettingsHandler } from './settings.handler.js';
import {
  updateSettingsRequestSchema,
  type SettingsResponse,
  type UpdateSettingsRequest,
} from './settings.schema.js';

@Controller('users')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class SettingsController {
  constructor(private readonly handler: SettingsHandler) {}

  @Get('me/settings')
  @UseGuards(JwtAuthGuard)
  async get(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SettingsResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.handler.get(principal);
  }

  @Patch('me/settings')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
      getTracker: (request: Record<string, unknown>) =>
        `update-settings|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
    },
  })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateSettingsRequestSchema))
    body: UpdateSettingsRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SettingsResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.handler.update(principal, body);
  }
}
