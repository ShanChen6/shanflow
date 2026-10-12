import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../../../database/normalize-email.js';
import { PasswordHasher } from '../../../shared/crypto/password-hasher.js';
import { AccessTokenService } from '../shared/access-token.service.js';
import { InvalidCredentialsError } from '../shared/auth.errors.js';
import {
  RefreshSessionStore,
  type CreatedRefreshSession,
} from '../shared/refresh-session.store.js';
import type { LoginRequest, LoginResponse } from './login.schema.js';

export interface LoginResult {
  body: LoginResponse;
  refreshSession: CreatedRefreshSession;
}

@Injectable()
export class LoginHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: RefreshSessionStore,
  ) {}

  async execute(request: LoginRequest): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(request.email) },
      include: { passwordCredential: true },
    });
    const credential = user?.passwordCredential;

    if (!user || !credential) {
      // Unknown email or an account without a password (e.g. OAuth-only): burn the same work as a real check.
      await this.hasher.verifyDummy(request.password);
      throw new InvalidCredentialsError();
    }
    if (
      !(await this.hasher.verify(credential.passwordHash, request.password))
    ) {
      throw new InvalidCredentialsError();
    }
    // Checked after the password so a suspended account is indistinguishable from a wrong password.
    if (user.accountStatus !== 'ACTIVE') throw new InvalidCredentialsError();

    await this.upgradeHashIfNeeded(
      user.id,
      credential.passwordHash,
      request.password,
    );

    const refreshSession = await this.sessions.createFamily(user.id);
    const access = await this.accessTokens.sign({
      userId: user.id,
      sessionId: refreshSession.sessionId,
    });
    return {
      refreshSession,
      body: {
        accessToken: access.token,
        tokenType: 'Bearer',
        expiresIn: access.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerifiedAt !== null,
        },
      },
    };
  }

  /** Transparently moves old hashes to current parameters; a failure must never fail the login. */
  private async upgradeHashIfNeeded(
    userId: string,
    currentHash: string,
    password: string,
  ): Promise<void> {
    if (!this.hasher.needsRehash(currentHash)) return;
    try {
      await this.prisma.passwordCredential.update({
        where: { userId },
        data: {
          passwordHash: await this.hasher.hash(password),
          passwordUpdatedAt: new Date(),
        },
      });
    } catch {
      // Ignored: the user authenticated successfully and will be upgraded on a later login.
    }
  }
}
