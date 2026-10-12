import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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

@Injectable()
export class RefreshSessionStore {
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
}
