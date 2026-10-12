import { Controller, Get, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { CurrentPrincipal } from '../shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import type { Principal } from '../shared/principal.js';
import { MeHandler } from './me.handler.js';
import type { MeResponse } from './me.schema.js';

@Controller('auth')
@UseFilters(ProblemDetailsFilter)
export class MeController {
  constructor(private readonly handler: MeHandler) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    response.setHeader('Cache-Control', 'no-store');
    return this.handler.execute(principal);
  }
}
