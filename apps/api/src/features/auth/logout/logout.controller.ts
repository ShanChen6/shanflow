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
} from '../shared/auth-cookie.js';
import { CookieCsrfGuard } from '../shared/cookie-csrf.guard.js';
import { CurrentPrincipal } from '../shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import type { Principal } from '../shared/principal.js';
import { LogoutHandler } from './logout.handler.js';

@Controller('auth')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class LogoutController {
  constructor(
    private readonly handler: LogoutHandler,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  private forgetCookie(response: Response): void {
    clearRefreshCookie(response, {
      secure: this.config.AUTH_COOKIE_SECURE,
      domain: this.config.AUTH_COOKIE_DOMAIN,
    });
    response.setHeader('Cache-Control', 'no-store');
  }

  /** Authenticated by the refresh cookie, so it needs the Origin/header CSRF check like refresh. */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard, CookieCsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.handler.logout(
      readCookie(request.headers.cookie, REFRESH_COOKIE_NAME),
    );
    this.forgetCookie(response);
  }

  /** Authenticated by a Bearer access token, which a cross-site request cannot attach, so no CSRF check. */
  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard, JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async logoutAll(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.handler.logoutAll(principal);
    this.forgetCookie(response);
  }
}
