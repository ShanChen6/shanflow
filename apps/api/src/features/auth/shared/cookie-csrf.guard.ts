import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@shanflow/contracts';
import { authConfig } from '../../../config/auth.config.js';
import { CsrfRejectedError } from './auth.errors.js';

/**
 * Defence in depth for endpoints authenticated by the refresh cookie (D4), on top of SameSite=Strict:
 * the Origin header must be exactly the web origin, and a custom header must be present.
 * Non-browser clients must send both too; there is no bypass.
 */
@Injectable()
export class CookieCsrfGuard implements CanActivate {
  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    const marker = request.get(CSRF_HEADER_NAME);
    if (origin !== this.config.WEB_ORIGIN || marker !== CSRF_HEADER_VALUE)
      throw new CsrfRejectedError();
    return true;
  }
}
