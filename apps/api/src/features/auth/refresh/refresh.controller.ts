import {
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { authConfig } from '../../../config/auth.config.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  readCookie,
  setRefreshCookie,
} from '../shared/auth-cookie.js';
import { UnauthenticatedError } from '../shared/auth.errors.js';
import { CookieCsrfGuard } from '../shared/cookie-csrf.guard.js';
import { RefreshHandler } from './refresh.handler.js';
import type { RefreshResponse } from './refresh.schema.js';

@Controller('auth')
@UseFilters(ProblemDetailsFilter)
export class RefreshController {
  constructor(
    private readonly handler: RefreshHandler,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  // Throttle first so rejected requests also spend budget; then the CSRF check, before any database work.
  @UseGuards(ThrottlerGuard, CookieCsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SkipThrottle({ 'login-email': true })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RefreshResponse> {
    const cookieOptions = {
      secure: this.config.AUTH_COOKIE_SECURE,
      domain: this.config.AUTH_COOKIE_DOMAIN,
    };
    response.setHeader('Cache-Control', 'no-store');
    try {
      const { body, refreshSession } = await this.handler.execute(
        readCookie(request.headers.cookie, REFRESH_COOKIE_NAME),
      );
      setRefreshCookie(
        response,
        refreshSession.token,
        refreshSession.expiresAt,
        cookieOptions,
      );
      return body;
    } catch (error) {
      // A rejected token is dead for good; drop it so the browser stops sending it.
      if (error instanceof UnauthenticatedError)
        clearRefreshCookie(response, cookieOptions);
      throw error;
    }
  }
}
