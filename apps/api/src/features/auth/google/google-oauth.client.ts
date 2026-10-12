import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { authConfig } from '../../../config/auth.config.js';

export interface GoogleProfile {
  /** Google's stable account identifier: the only identity key (email can change). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export class GoogleExchangeError extends Error {}

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const REQUEST_TIMEOUT_MS = 5000;

/** Talks to Google's OpenID Connect endpoints. Every failure is a GoogleExchangeError without provider detail. */
@Injectable()
export class GoogleOAuthClient {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  isConfigured(): boolean {
    return this.config.GOOGLE !== undefined;
  }

  private get google() {
    if (!this.config.GOOGLE) throw new GoogleExchangeError();
    return this.config.GOOGLE;
  }

  buildAuthorizationUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string {
    const { clientId, redirectUri, authorizationEndpoint } = this.google;
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      // Always let the user pick: avoids silently signing in with whichever Google account is active.
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Exchanges the authorization code (with the PKCE verifier) and validates the returned ID token. */
  async exchangeCode(
    code: string,
    codeVerifier: string,
    expectedNonce: string,
  ): Promise<GoogleProfile> {
    const { clientId, clientSecret, redirectUri, tokenEndpoint, jwksUri } =
      this.google;
    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new GoogleExchangeError();
      const body = (await response.json()) as { id_token?: unknown };
      if (typeof body.id_token !== 'string') throw new GoogleExchangeError();

      this.jwks ??= createRemoteJWKSet(new URL(jwksUri), {
        timeoutDuration: REQUEST_TIMEOUT_MS,
      });
      const { payload } = await jwtVerify(body.id_token, this.jwks, {
        algorithms: ['RS256'],
        issuer: ISSUERS,
        audience: clientId,
        requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce'],
      });
      if (payload.nonce !== expectedNonce) throw new GoogleExchangeError();
      if (typeof payload.sub !== 'string' || payload.sub === '')
        throw new GoogleExchangeError();
      if (typeof payload.email !== 'string' || payload.email === '')
        throw new GoogleExchangeError();
      return {
        subject: payload.sub,
        email: payload.email,
        // Google sends a boolean; some tokens carry the string form.
        emailVerified:
          payload.email_verified === true || payload.email_verified === 'true',
        name: typeof payload.name === 'string' ? payload.name : undefined,
        picture:
          typeof payload.picture === 'string' ? payload.picture : undefined,
      };
    } catch (error) {
      throw error instanceof GoogleExchangeError
        ? error
        : new GoogleExchangeError();
    }
  }
}
