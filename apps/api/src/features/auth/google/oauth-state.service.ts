import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { authConfig } from '../../../config/auth.config.js';
import { Clock } from '../../../shared/clock.js';
import { generateSecureToken } from '../../../shared/crypto/secure-token.js';

export type OAuthIntent = 'login' | 'link';

export interface OAuthStatePayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  intent: OAuthIntent;
  /** Only for `link`: the signed-in user who confirmed their password to start the flow. */
  userId?: string;
}

export interface StartedOAuth {
  state: string;
  nonce: string;
  codeChallenge: string;
  /** Value of the state cookie. */
  cookieValue: string;
}

const ALGORITHM = 'HS256';
const TYPE = 'oauth-state+jwt';
const AUDIENCE = 'shanflow-oauth-state';
const TTL_SECONDS = 10 * 60;

/**
 * The state cookie is a signed JWT with its own audience and type, so it can never be mistaken for an
 * access token or the other way round. It holds the PKCE verifier and nonce for this one login attempt.
 */
@Injectable()
export class OAuthStateService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async start(intent: OAuthIntent, userId?: string): Promise<StartedOAuth> {
    const state = generateSecureToken();
    const nonce = generateSecureToken();
    const codeVerifier = generateSecureToken();
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const cookieValue = await new SignJWT({
      state,
      nonce,
      cv: codeVerifier,
      intent,
      ...(userId ? { uid: userId } : {}),
    })
      .setProtectedHeader({ alg: ALGORITHM, typ: TYPE })
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + TTL_SECONDS)
      .sign(this.key);
    return { state, nonce, codeChallenge, cookieValue };
  }

  /** Returns the payload only if the cookie is valid, fresh and its state equals the one echoed by the provider. */
  async read(
    cookieValue: string | undefined,
    stateFromProvider: string | undefined,
  ): Promise<OAuthStatePayload | null> {
    if (!cookieValue || !stateFromProvider) return null;
    try {
      const { payload } = await jwtVerify(cookieValue, this.key, {
        algorithms: [ALGORITHM],
        typ: TYPE,
        issuer: this.config.JWT_ISSUER,
        audience: AUDIENCE,
        currentDate: this.clock.now(),
        requiredClaims: ['state', 'nonce', 'cv', 'intent', 'exp'],
      });
      const { state, nonce, cv, intent, uid } = payload as Record<
        string,
        unknown
      >;
      if (
        typeof state !== 'string' ||
        typeof nonce !== 'string' ||
        typeof cv !== 'string'
      )
        return null;
      if (intent !== 'login' && intent !== 'link') return null;
      if (intent === 'link' && typeof uid !== 'string') return null;
      const expected = Buffer.from(state);
      const actual = Buffer.from(stateFromProvider);
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        return null;
      return {
        state,
        nonce,
        codeVerifier: cv,
        intent,
        ...(typeof uid === 'string' ? { userId: uid } : {}),
      };
    } catch {
      return null;
    }
  }
}
