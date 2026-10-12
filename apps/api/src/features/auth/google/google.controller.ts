import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  googleLinkStartRequestSchema,
  type GoogleLinkStartRequest,
  type GoogleLinkStartResponse,
} from '@shanflow/contracts';
import type { Request, Response } from 'express';
import { authConfig } from '../../../config/auth.config.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import {
  OAUTH_STATE_COOKIE_NAME,
  clearOAuthStateCookie,
  readCookie,
  setOAuthStateCookie,
  setRefreshCookie,
} from '../shared/auth-cookie.js';
import { CurrentPrincipal } from '../shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import type { AuthenticatedRequest, Principal } from '../shared/principal.js';
import { SensitiveSessionGuard } from '../shared/sensitive-session.guard.js';
import { GoogleCallbackHandler } from './google-callback.handler.js';
import { GoogleStartHandler } from './google-start.handler.js';

const MAX_PARAM_LENGTH = 2048;
const param = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_PARAM_LENGTH
    ? value
    : undefined;

@Controller('auth/google')
@UseFilters(ProblemDetailsFilter)
@SkipThrottle({ 'login-email': true })
export class GoogleController {
  constructor(
    private readonly starter: GoogleStartHandler,
    private readonly callback: GoogleCallbackHandler,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  private get cookieOptions() {
    return {
      secure: this.config.AUTH_COOKIE_SECURE,
      domain: this.config.AUTH_COOKIE_DOMAIN,
    };
  }

  /** Browser navigation target for "Continue with Google". */
  @Get('start')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async start(@Res() response: Response): Promise<void> {
    const started = await this.starter.startLogin();
    response.setHeader('Cache-Control', 'no-store');
    if (!started) {
      response.redirect(
        302,
        `${this.config.WEB_ORIGIN}/login?error=oauth_unavailable`,
      );
      return;
    }
    setOAuthStateCookie(response, started.stateCookieValue, this.cookieOptions);
    response.redirect(302, started.authorizationUrl);
  }

  /**
   * Starts linking for the signed-in user. Returns the URL instead of redirecting because the request is an
   * authenticated fetch (Bearer header); the web app then navigates the browser there.
   */
  @Post('link/start')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, SensitiveSessionGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: 15 * 60 * 1000,
      getTracker: (request: Record<string, unknown>) =>
        `google-link|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`,
    },
  })
  async startLink(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(googleLinkStartRequestSchema))
    body: GoogleLinkStartRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GoogleLinkStartResponse> {
    const started = await this.starter.startLink(principal, body.password);
    setOAuthStateCookie(response, started.stateCookieValue, this.cookieOptions);
    response.setHeader('Cache-Control', 'no-store');
    return { authorizationUrl: started.authorizationUrl };
  }

  /** Where Google sends the browser back. Always ends in a redirect to the web app. */
  @Get('callback')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async complete(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.callback.execute(
      {
        code: param(query.code),
        state: param(query.state),
        error: param(query.error),
      },
      readCookie(request.headers.cookie, OAUTH_STATE_COOKIE_NAME),
    );
    // One attempt per state cookie, success or not.
    clearOAuthStateCookie(response, this.cookieOptions);
    if (result.refreshSession) {
      setRefreshCookie(
        response,
        result.refreshSession.token,
        result.refreshSession.expiresAt,
        this.cookieOptions,
      );
    }
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(302, result.redirect);
  }
}
