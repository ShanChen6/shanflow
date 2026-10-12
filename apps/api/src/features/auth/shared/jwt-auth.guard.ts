import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AccessTokenService } from './access-token.service.js';
import { UnauthenticatedError } from './auth.errors.js';
import type { AuthenticatedRequest } from './principal.js';

// Real access tokens are ~250 bytes; refusing huge values avoids pointless parsing work.
const MAX_TOKEN_LENGTH = 2048;
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/**
 * Requires a valid Bearer access token and exposes the caller as `request.principal`.
 * It is stateless: it proves who the caller is, not that the account is still active or what
 * they may do. Services must authorize against the database (CDB-002).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (!token || token.length > MAX_TOKEN_LENGTH)
      throw new UnauthenticatedError();

    const claims = await this.accessTokens.verify(token);
    if (!claims) throw new UnauthenticatedError();
    request.principal = claims;
    return true;
  }
}
