import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { authConfig } from '../../../config/auth.config.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { setRefreshCookie } from '../shared/auth-cookie.js';
import { LoginHandler } from './login.handler.js';
import {
  loginRequestSchema,
  type LoginRequest,
  type LoginResponse,
} from './login.schema.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

@Controller('auth')
@UseFilters(ProblemDetailsFilter)
export class LoginController {
  constructor(
    private readonly handler: LoginHandler,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  // 50 attempts / 15 min per IP (default tracker) and 10 / 15 min per IP+email ('login-email', D12).
  @Throttle({
    default: { limit: 50, ttl: FIFTEEN_MINUTES_MS },
    'login-email': { limit: 10, ttl: FIFTEEN_MINUTES_MS },
  })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const { body: result, refreshSession } = await this.handler.execute(body);
    setRefreshCookie(response, refreshSession.token, refreshSession.expiresAt, {
      secure: this.config.AUTH_COOKIE_SECURE,
      domain: this.config.AUTH_COOKIE_DOMAIN,
    });
    // Responses carrying tokens must never be cached by browsers or intermediaries.
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
