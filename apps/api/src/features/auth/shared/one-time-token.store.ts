import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import {
  generateSecureToken,
  hashSecureToken,
} from '../../../shared/crypto/secure-token.js';
import type { OneTimeTokenPurpose } from '../../../generated/prisma/client.js';
import type { Tx } from './transaction.js';

const MINUTE_MS = 60 * 1000;
/** Mailbox links outlive a coffee break but not a weekend; reset links are the more dangerous, so shorter. */
export const TOKEN_TTL_MS: Record<OneTimeTokenPurpose, number> = {
  EMAIL_VERIFICATION: 24 * 60 * MINUTE_MS,
  PASSWORD_RESET: 60 * MINUTE_MS,
};

export interface ConsumedToken {
  userId: string;
  /** The email a verification token was issued for; null for other purposes. */
  email: string | null;
}

@Injectable()
export class OneTimeTokenStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Issues a fresh token and discards the user's earlier unused tokens of the same purpose, so only the
   * newest emailed link works. Only the SHA-256 hash is stored; the raw value exists only in the email.
   */
  async issue(
    userId: string,
    purpose: OneTimeTokenPurpose,
    options: { email?: string } = {},
  ): Promise<string> {
    const token = generateSecureToken();
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.oneTimeToken.deleteMany({
        where: { userId, purpose, usedAt: null },
      }),
      this.prisma.oneTimeToken.create({
        data: {
          userId,
          purpose,
          email: options.email ?? null,
          tokenHash: hashSecureToken(token),
          createdAt: now,
          expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]),
        },
      }),
    ]);
    return token;
  }

  /**
   * Claims a token with one atomic UPDATE, so of any number of concurrent attempts exactly one wins.
   * Unknown, expired, already used and wrong-purpose tokens are indistinguishable (null).
   * Pass the caller's transaction so the claim and the action it authorizes commit together.
   */
  async consume(
    tx: Tx,
    rawToken: string,
    purpose: OneTimeTokenPurpose,
  ): Promise<ConsumedToken | null> {
    const tokenHash = hashSecureToken(rawToken);
    const claimed = await tx.oneTimeToken.updateMany({
      where: {
        tokenHash,
        purpose,
        usedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      data: { usedAt: this.clock.now() },
    });
    if (claimed.count !== 1) return null;
    const row = await tx.oneTimeToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true, email: true },
    });
    return { userId: row.userId, email: row.email };
  }
}
