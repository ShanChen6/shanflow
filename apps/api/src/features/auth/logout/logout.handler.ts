import { Injectable } from '@nestjs/common';
import { RefreshSessionStore } from '../shared/refresh-session.store.js';
import type { Principal } from '../shared/principal.js';

@Injectable()
export class LogoutHandler {
  constructor(private readonly sessions: RefreshSessionStore) {}

  /** Ends the session family of the refresh cookie. Always succeeds: a missing or unknown token is already logged out. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.sessions.revokeFamilyByToken(rawToken);
  }

  /** Ends every session of the authenticated user, on all devices. */
  async logoutAll(principal: Principal): Promise<void> {
    await this.sessions.revokeAllForUser(principal.userId);
  }
}
