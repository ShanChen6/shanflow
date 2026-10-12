import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { authConfig } from '../../../config/auth.config.js';
import { Clock } from '../../../shared/clock.js';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

const ALGORITHM = 'HS256';

/**
 * Short-lived JWT proving identity only. It carries no role or workspace data:
 * authorization is always decided from the database at the service layer.
 */
@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async sign(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresIn = this.config.ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + expiresIn)
      .sign(this.key);
    return { token, expiresIn };
  }

  /** Returns the claims, or null for any invalid token. Never throws on bad input. */
  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
        currentDate: this.clock.now(),
        requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string')
        return null;
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      return null;
    }
  }
}
