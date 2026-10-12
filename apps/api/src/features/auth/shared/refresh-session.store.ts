import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../../../config/auth.config.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import {
  generateSecureToken,
  hashSecureToken,
} from '../../../shared/crypto/secure-token.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreatedRefreshSession {
  /** The raw secret. Returned once to be set as a cookie; only its hash is stored. */
  token: string;
  sessionId: string;
  familyId: string;
  expiresAt: Date;
}

export type RotationResult =
  | {
      status: 'rotated';
      session: CreatedRefreshSession;
      user: {
        id: string;
        email: string;
        displayName: string;
        emailVerified: boolean;
      };
    }
  /** Unknown, expired or already-revoked token, or the account is no longer active. */
  | { status: 'invalid' }
  /** A consumed token was presented again: the whole family has been revoked. */
  | { status: 'reuse' };

@Injectable()
export class RefreshSessionStore {
  private readonly logger = new Logger(RefreshSessionStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /** Starts a new session family (one per login) with its first generation. */
  async createFamily(userId: string): Promise<CreatedRefreshSession> {
    const token = generateSecureToken();
    const familyId = randomUUID();
    const now = this.clock.now();
    const expiresAt = new Date(
      now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
    );
    const session = await this.prisma.refreshSession.create({
      data: {
        userId,
        familyId,
        tokenHash: hashSecureToken(token),
        createdAt: now,
        expiresAt,
      },
      select: { id: true },
    });
    return { token, sessionId: session.id, familyId, expiresAt };
  }

  /**
   * Exchanges a refresh token for its successor (ADR-010). One transaction:
   *  1. find the session by token hash;
   *  2. take a transaction-scoped advisory lock on the family, so refresh and revocation of the same
   *     family are serialized (locking one generation row would not be enough);
   *  3. re-read the session under the lock, so concurrent holders of the same token cannot both win.
   * Failure outcomes are returned (not thrown) so that family revocation is committed.
   */
  async rotate(rawToken: string): Promise<RotationResult> {
    const tokenHash = hashSecureToken(rawToken);
    const outcome = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<
        RotationResult & { audit?: { userId: string; familyId: string } }
      > => {
        const found = await tx.refreshSession.findUnique({
          where: { tokenHash },
          select: { id: true, familyId: true },
        });
        if (!found) return { status: 'invalid' };

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${found.familyId}::text, 0))`;
        const session = await tx.refreshSession.findUnique({
          where: { id: found.id },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                accountStatus: true,
                emailVerifiedAt: true,
              },
            },
          },
        });
        if (!session) return { status: 'invalid' };

        const now = this.clock.now();
        const revokeFamily = () =>
          tx.refreshSession.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now },
          });

        if (session.revokedAt !== null) return { status: 'invalid' };
        if (session.usedAt !== null) {
          await revokeFamily();
          return {
            status: 'reuse',
            audit: { userId: session.userId, familyId: session.familyId },
          };
        }
        if (session.expiresAt.getTime() <= now.getTime())
          return { status: 'invalid' };
        if (session.user.accountStatus !== 'ACTIVE') {
          await revokeFamily();
          return { status: 'invalid' };
        }

        const token = generateSecureToken();
        // The successor keeps the family's absolute expiry: refreshing never extends the 30-day cap (D8).
        const successor = await tx.refreshSession.create({
          data: {
            userId: session.userId,
            familyId: session.familyId,
            tokenHash: hashSecureToken(token),
            createdAt: now,
            expiresAt: session.expiresAt,
          },
          select: { id: true },
        });
        await tx.refreshSession.update({
          where: { id: session.id },
          data: { usedAt: now, lastUsedAt: now, replacedById: successor.id },
        });
        return {
          status: 'rotated',
          session: {
            token,
            sessionId: successor.id,
            familyId: session.familyId,
            expiresAt: session.expiresAt,
          },
          user: {
            id: session.user.id,
            email: session.user.email,
            displayName: session.user.displayName,
            emailVerified: session.user.emailVerifiedAt !== null,
          },
        };
      },
    );

    if (outcome.status === 'reuse' && 'audit' in outcome && outcome.audit) {
      // Identifiers only: never log the token or its hash.
      this.logger.warn(
        `Refresh token reuse detected; family revoked (user ${outcome.audit.userId}, family ${outcome.audit.familyId}).`,
      );
    }
    return outcome.status === 'reuse' ? { status: 'reuse' } : outcome;
  }
}
