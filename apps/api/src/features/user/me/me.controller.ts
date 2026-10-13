import { Controller, Get, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../auth/shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../../auth/shared/jwt-auth.guard.js';
import type { Principal } from '../../auth/shared/principal.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { GetMeHandler } from './me.handler.js';
import type { GetUserMeResponse } from './me.schema.js';

@Controller('users')
@UseFilters(ProblemDetailsFilter)
export class GetMeController {
  constructor(private readonly handler: GetMeHandler) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GetUserMeResponse> {
    // Personal data: never stored by shared caches or the browser.
    response.setHeader('Cache-Control', 'private, no-store');
    return this.handler.execute(principal);
  }
}
