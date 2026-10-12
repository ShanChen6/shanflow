import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { UnauthenticatedError } from './auth.errors.js';
import type { AuthenticatedRequest } from './principal.js';
import { RefreshSessionStore } from './refresh-session.store.js';

/**
 * Use after JwtAuthGuard on sensitive operations (change password, link an identity). A valid token is
 * not enough: its session must still be live in the database, so logging out or revoking a device takes
 * effect immediately instead of after the access token's lifetime. Exposes `principal.familyId`.
 */
@Injectable()
export class SensitiveSessionGuard implements CanActivate {
  constructor(private readonly sessions: RefreshSessionStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (!principal) throw new UnauthenticatedError();
    const live = await this.sessions.findLiveSession(
      principal.sessionId,
      principal.userId,
    );
    if (!live) throw new UnauthenticatedError();
    principal.familyId = live.familyId;
    return true;
  }
}
