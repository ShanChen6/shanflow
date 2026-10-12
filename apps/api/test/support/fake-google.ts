import { createHash, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
  type CryptoKey,
} from 'jose';

export interface FakeIdentity {
  sub: string;
  email: string;
  emailVerified?: boolean | string;
  name?: string;
  picture?: string;
}

/** Ways a hostile or broken provider can misbehave; each should make the API reject the sign-in. */
export interface Tamper {
  audience?: string;
  issuer?: string;
  nonce?: string;
  expired?: boolean;
  /** Sign with a key that is not in the published JWKS. */
  foreignKey?: boolean;
  omitIdToken?: boolean;
  tokenStatus?: number;
}

interface PendingCode {
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  identity: FakeIdentity;
  tamper: Tamper;
}

const CLIENT_ID = 'fake-client-id.apps.example.invalid';
const CLIENT_SECRET = 'fake-client-secret';

/**
 * A minimal OpenID Connect provider standing in for Google: authorize, token and JWKS endpoints with real
 * PKCE verification and RS256 ID tokens. Lets the whole flow run end to end without network access.
 */
export class FakeGoogle {
  readonly clientId = CLIENT_ID;
  readonly clientSecret = CLIENT_SECRET;
  /** Who signs in on the next authorization request. */
  nextIdentity: FakeIdentity = {
    sub: randomUUID(),
    email: 'person@example.invalid',
    emailVerified: true,
    name: 'Fake Person',
  };
  /** If set, the next authorization request is refused by the "user". */
  denyNext = false;
  tamper: Tamper = {};
  readonly tokenRequests: URLSearchParams[] = [];

  private server!: Server;
  private signingKey!: CryptoKey;
  private foreignKey!: CryptoKey;
  private jwk!: JWK;
  private codes = new Map<string, PendingCode>();
  private origin = '';

  async start(): Promise<void> {
    const pair = await generateKeyPair('RS256');
    this.signingKey = pair.privateKey;
    this.foreignKey = (await generateKeyPair('RS256')).privateKey;
    this.jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: 'fake-key',
      alg: 'RS256',
      use: 'sig',
    };
    this.server = createServer(
      (request, response) => void this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Environment that points the API at this provider (non-production overrides). */
  env(apiOrigin: string): Record<string, string> {
    return {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: `${apiOrigin}/auth/google/callback`,
      GOOGLE_AUTHORIZATION_ENDPOINT: `${this.origin}/authorize`,
      GOOGLE_TOKEN_ENDPOINT: `${this.origin}/token`,
      GOOGLE_JWKS_URI: `${this.origin}/jwks`,
    };
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', this.origin);
    if (request.method === 'GET' && url.pathname === '/jwks') {
      response
        .setHeader('Content-Type', 'application/json')
        .end(JSON.stringify({ keys: [this.jwk] }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/authorize') {
      this.authorize(url, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/token') {
      await this.token(request, response);
      return;
    }
    response.statusCode = 404;
    response.end();
  }

  private authorize(url: URL, response: ServerResponse): void {
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const target = new URL(redirectUri);
    if (
      url.searchParams.get('client_id') !== CLIENT_ID ||
      url.searchParams.get('code_challenge_method') !== 'S256'
    ) {
      target.searchParams.set('error', 'invalid_request');
    } else if (this.denyNext) {
      this.denyNext = false;
      target.searchParams.set('error', 'access_denied');
    } else {
      const code = randomUUID();
      this.codes.set(code, {
        nonce: url.searchParams.get('nonce') ?? '',
        codeChallenge: url.searchParams.get('code_challenge') ?? '',
        redirectUri,
        identity: this.nextIdentity,
        tamper: this.tamper,
      });
      target.searchParams.set('code', code);
    }
    target.searchParams.set('state', state);
    response.statusCode = 302;
    response.setHeader('Location', target.toString()).end();
  }

  private async token(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const form = new URLSearchParams(raw);
    this.tokenRequests.push(form);
    const pending = this.codes.get(form.get('code') ?? '');
    this.codes.delete(form.get('code') ?? '');
    const verifierOk =
      pending !== undefined &&
      createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url') === pending.codeChallenge;
    const valid =
      pending !== undefined &&
      verifierOk &&
      form.get('client_id') === CLIENT_ID &&
      form.get('client_secret') === CLIENT_SECRET &&
      form.get('redirect_uri') === pending.redirectUri &&
      form.get('grant_type') === 'authorization_code';
    if (!valid || !pending) {
      response.statusCode = 400;
      response
        .setHeader('Content-Type', 'application/json')
        .end(JSON.stringify({ error: 'invalid_grant' }));
      return;
    }
    if (pending.tamper.tokenStatus) {
      response.statusCode = pending.tamper.tokenStatus;
      response.end();
      return;
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const { identity, tamper } = pending;
    const idToken = await new SignJWT({
      email: identity.email,
      email_verified: identity.emailVerified ?? true,
      name: identity.name,
      picture: identity.picture,
      nonce: tamper.nonce ?? pending.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'fake-key' })
      .setIssuer(tamper.issuer ?? 'https://accounts.google.com')
      .setAudience(tamper.audience ?? CLIENT_ID)
      .setSubject(identity.sub)
      .setIssuedAt(tamper.expired ? issuedAt - 7200 : issuedAt)
      .setExpirationTime(tamper.expired ? issuedAt - 3600 : issuedAt + 3600)
      .sign(tamper.foreignKey ? this.foreignKey : this.signingKey);
    response
      .setHeader('Content-Type', 'application/json')
      .end(
        JSON.stringify({
          access_token: 'fake-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          ...(tamper.omitIdToken ? {} : { id_token: idToken }),
        }),
      );
  }
}
