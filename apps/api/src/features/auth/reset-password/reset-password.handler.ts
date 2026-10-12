import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import { PasswordHasher } from '../../../shared/crypto/password-hasher.js';
import { InvalidTokenError } from '../shared/auth.errors.js';
import { OneTimeTokenStore } from '../shared/one-time-token.store.js';
import { RefreshSessionStore } from '../shared/refresh-session.store.js';
import type { ResetPasswordRequest } from './reset-password.schema.js';

@Injectable()
export class ResetPasswordHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OneTimeTokenStore,
    private readonly sessions: RefreshSessionStore,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
  ) {}

  /**
   * Public: the emailed token is the credential. In one transaction the token is claimed, the password
   * replaced, other reset links discarded and every session revoked, so a failure leaves nothing half done.
   * The user is not signed in: whoever holds the link must still log in with the new password.
   */
  async execute(request: ResetPasswordRequest): Promise<void> {
    // Hash first so no transaction (and its locks) is held during the CPU-bound work.
    const passwordHash = await this.hasher.hash(request.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await this.tokens.consume(
        tx,
        request.token,
        'PASSWORD_RESET',
      );
      if (!claimed) throw new InvalidTokenError();
      const user = await tx.user.findUnique({
        where: { id: claimed.userId },
        select: { accountStatus: true, emailVerifiedAt: true },
      });
      if (!user || user.accountStatus !== 'ACTIVE')
        throw new InvalidTokenError();

      const now = this.clock.now();
      await tx.passwordCredential.upsert({
        where: { userId: claimed.userId },
        create: {
          userId: claimed.userId,
          passwordHash,
          passwordUpdatedAt: now,
        },
        update: { passwordHash, passwordUpdatedAt: now },
      });
      // Receiving the email proves control of the mailbox.
      if (user.emailVerifiedAt === null) {
        await tx.user.update({
          where: { id: claimed.userId },
          data: { emailVerifiedAt: now },
        });
      }
      await tx.oneTimeToken.deleteMany({
        where: {
          userId: claimed.userId,
          purpose: 'PASSWORD_RESET',
          usedAt: null,
        },
      });
      await this.sessions.revokeAllForUser(claimed.userId, { tx });
    });
  }
}
