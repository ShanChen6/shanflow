import { Injectable } from '@nestjs/common';
import { AccessTokenService } from '../shared/access-token.service.js';
import { UnauthenticatedError } from '../shared/auth.errors.js';
import {
  RefreshSessionStore,
  type CreatedRefreshSession,
} from '../shared/refresh-session.store.js';
import type { RefreshResponse } from './refresh.schema.js';

export interface RefreshResult {
  body: RefreshResponse;
  refreshSession: CreatedRefreshSession;
}

@Injectable()
export class RefreshHandler {
  constructor(
    private readonly sessions: RefreshSessionStore,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /** `rawToken` is the refresh cookie value, if any. Every failure is the same UnauthenticatedError. */
  async execute(rawToken: string | undefined): Promise<RefreshResult> {
    if (!rawToken) throw new UnauthenticatedError();
    const rotation = await this.sessions.rotate(rawToken);
    if (rotation.status !== 'rotated') throw new UnauthenticatedError();

    const access = await this.accessTokens.sign({
      userId: rotation.user.id,
      sessionId: rotation.session.sessionId,
    });
    return {
      refreshSession: rotation.session,
      body: {
        accessToken: access.token,
        tokenType: 'Bearer',
        expiresIn: access.expiresIn,
        user: rotation.user,
      },
    };
  }
}
