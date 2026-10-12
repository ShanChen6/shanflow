import { PersonalWorkspaceService } from '../../workspace/shared/personal-workspace.service.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { OAuthErrorCode } from '@shanflow/contracts';
import { authConfig } from '../../../config/auth.config.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../../../database/normalize-email.js';
import { Clock } from '../../../shared/clock.js';
import type { CreatedRefreshSession } from '../shared/refresh-session.store.js';
import { RefreshSessionStore } from '../shared/refresh-session.store.js';
import {
  GoogleOAuthClient,
  GoogleExchangeError,
  type GoogleProfile,
} from './google-oauth.client.js';
import {
  OAuthStateService,
  type OAuthStatePayload,
} from './oauth-state.service.js';

export interface CallbackInput {
  code?: string;
  state?: string;
  /** The provider's `error` parameter (e.g. access_denied). Never shown to the user. */
  error?: string;
}

export interface CallbackResult {
  redirect: string;
  /** Set when a sign-in succeeded: the controller turns it into the refresh cookie. */
  refreshSession?: CreatedRefreshSession;
}

const UNIQUE_VIOLATION = 'P2002';
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === UNIQUE_VIOLATION;

@Injectable()
export class GoogleCallbackHandler {
  private readonly logger = new Logger(GoogleCallbackHandler.name);

  constructor(
    private readonly client: GoogleOAuthClient,
    private readonly states: OAuthStateService,
    private readonly prisma: PrismaService,
    private readonly sessions: RefreshSessionStore,
    private readonly clock: Clock,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
    private readonly personalWorkspace: PersonalWorkspaceService,
  ) {}

  private failure(code: OAuthErrorCode): CallbackResult {
    return { redirect: `${this.config.WEB_ORIGIN}/login?error=${code}` };
  }

  /**
   * Completes a Google flow. It never throws and never puts provider text in the redirect: the browser is
   * sent to the web app with either a session cookie or one of a fixed set of error codes.
   */
  async execute(
    input: CallbackInput,
    stateCookie: string | undefined,
  ): Promise<CallbackResult> {
    if (!this.client.isConfigured()) return this.failure('oauth_unavailable');
    if (input.error)
      return this.failure(
        input.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed',
      );

    const state = await this.states.read(stateCookie, input.state);
    if (!state || !input.code) return this.failure('oauth_failed');

    let profile: GoogleProfile;
    try {
      profile = await this.client.exchangeCode(
        input.code,
        state.codeVerifier,
        state.nonce,
      );
    } catch (error) {
      if (!(error instanceof GoogleExchangeError))
        this.logger.error('Unexpected failure completing Google sign-in.');
      return this.failure('oauth_failed');
    }
    if (!profile.emailVerified) return this.failure('email_unverified');

    try {
      return state.intent === 'link'
        ? await this.link(state, profile)
        : await this.signIn(profile);
    } catch {
      this.logger.error('Unexpected failure completing Google sign-in.');
      return this.failure('oauth_failed');
    }
  }

  private async signIn(
    profile: GoogleProfile,
    retry = true,
  ): Promise<CallbackResult> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.subject,
        },
      },
      select: { id: true, user: { select: { id: true, accountStatus: true } } },
    });
    if (linked) {
      if (linked.user.accountStatus !== 'ACTIVE')
        return this.failure('account_unavailable');
      await this.prisma.oAuthAccount.update({
        where: { id: linked.id },
        data: {
          providerEmail: profile.email,
          providerEmailVerified: profile.emailVerified,
        },
      });
      return this.signedIn(linked.user.id);
    }

    const email = normalizeEmail(profile.email);
    // An existing account with this address is never linked silently (ADR-001): the owner must sign in
    // with their password and link Google deliberately. Otherwise anyone controlling a Google account for
    // that address could take over a password account registered (unverified) with it.
    if (
      await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })
    )
      return this.failure('account_exists');

    try {
      // One transaction: the user (with its Google link) and its personal workspace commit together.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            displayName: displayNameFrom(profile, email),
            avatarUrl: avatarFrom(profile),
            // Google vouched for the address and we required email_verified.
            emailVerifiedAt: this.clock.now(),
            oauthAccounts: {
              create: {
                provider: 'GOOGLE',
                providerAccountId: profile.subject,
                providerEmail: profile.email,
                providerEmailVerified: profile.emailVerified,
              },
            },
          },
          select: { id: true },
        });
        await this.personalWorkspace.ensure(created.id, tx);
        return created;
      });
      return this.signedIn(user.id);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent callback (double click) created it first: sign in with what now exists.
      return retry
        ? this.signIn(profile, false)
        : this.failure('account_exists');
    }
  }

  private async signedIn(userId: string): Promise<CallbackResult> {
    const refreshSession = await this.sessions.createFamily(userId);
    return { redirect: `${this.config.WEB_ORIGIN}/account`, refreshSession };
  }

  private async link(
    state: OAuthStatePayload,
    profile: GoogleProfile,
  ): Promise<CallbackResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: state.userId },
      select: {
        accountStatus: true,
        oauthAccounts: {
          where: { provider: 'GOOGLE' },
          select: { providerAccountId: true },
        },
      },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      return this.failure('account_unavailable');
    const existing = user.oauthAccounts[0];
    if (existing) {
      return existing.providerAccountId === profile.subject
        ? this.linkedRedirect()
        : this.failure('already_linked');
    }
    try {
      await this.prisma.oAuthAccount.create({
        data: {
          userId: state.userId!,
          provider: 'GOOGLE',
          providerAccountId: profile.subject,
          providerEmail: profile.email,
          providerEmailVerified: profile.emailVerified,
        },
      });
    } catch (error) {
      // The subject already belongs to another account (or a concurrent link won).
      if (isUniqueViolation(error)) return this.failure('already_linked');
      throw error;
    }
    return this.linkedRedirect();
  }

  private linkedRedirect(): CallbackResult {
    return { redirect: `${this.config.WEB_ORIGIN}/account?linked=google` };
  }
}

function displayNameFrom(
  profile: GoogleProfile,
  canonicalEmail: string,
): string {
  const name = profile.name?.trim().slice(0, 80);
  return name || canonicalEmail.split('@')[0]!.slice(0, 80);
}

/** Only an https image URL is kept; anything else is dropped rather than stored. */
function avatarFrom(profile: GoogleProfile): string | null {
  if (!profile.picture || profile.picture.length > 2048) return null;
  try {
    return new URL(profile.picture).protocol === 'https:'
      ? profile.picture
      : null;
  } catch {
    return null;
  }
}
