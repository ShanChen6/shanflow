import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { PasswordHasher } from '../../../shared/crypto/password-hasher.js';
import {
  AlreadyLinkedError,
  OAuthNotConfiguredError,
  PasswordNotSetError,
  UnauthenticatedError,
  WrongPasswordError,
} from '../shared/auth.errors.js';
import type { Principal } from '../shared/principal.js';
import { GoogleOAuthClient } from './google-oauth.client.js';
import { OAuthStateService } from './oauth-state.service.js';

export interface StartedGoogleFlow {
  authorizationUrl: string;
  stateCookieValue: string;
}

@Injectable()
export class GoogleStartHandler {
  constructor(
    private readonly client: GoogleOAuthClient,
    private readonly states: OAuthStateService,
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Sign in or sign up with Google. Returns null when Google sign-in is not configured. */
  async startLogin(): Promise<StartedGoogleFlow | null> {
    if (!this.client.isConfigured()) return null;
    const started = await this.states.start('login');
    return {
      authorizationUrl: this.client.buildAuthorizationUrl(started),
      stateCookieValue: started.cookieValue,
    };
  }

  /**
   * Link Google to the signed-in account. Needs the current password again (recent reauthentication,
   * ADR-001), so a stolen access token alone cannot attach an attacker's Google account.
   */
  async startLink(
    principal: Principal,
    password: string,
  ): Promise<StartedGoogleFlow> {
    if (!this.client.isConfigured()) throw new OAuthNotConfiguredError();
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        accountStatus: true,
        passwordCredential: { select: { passwordHash: true } },
        oauthAccounts: { where: { provider: 'GOOGLE' }, select: { id: true } },
      },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
    if (!user.passwordCredential) throw new PasswordNotSetError();
    if (
      !(await this.hasher.verify(
        user.passwordCredential.passwordHash,
        password,
      ))
    )
      throw new WrongPasswordError();
    if (user.oauthAccounts.length > 0) throw new AlreadyLinkedError();

    const started = await this.states.start('link', principal.userId);
    return {
      authorizationUrl: this.client.buildAuthorizationUrl(started),
      stateCookieValue: started.cookieValue,
    };
  }
}
