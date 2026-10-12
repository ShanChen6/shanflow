import { z } from 'zod';
import { presentedPasswordSchema } from './password.js';

export const OAUTH_PROVIDERS = ['google'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Linking an identity needs the current password again (recent reauthentication, ADR-001). */
export const googleLinkStartRequestSchema = z.object({ password: presentedPasswordSchema });
export const googleLinkStartResponseSchema = z.object({ authorizationUrl: z.url() });

export type GoogleLinkStartRequest = z.infer<typeof googleLinkStartRequestSchema>;
export type GoogleLinkStartResponse = z.infer<typeof googleLinkStartResponseSchema>;

/** `?error=` values the API redirects to the sign-in page with after a failed Google flow. */
export const OAUTH_ERROR_CODES = [
  'oauth_failed',
  'oauth_cancelled',
  'oauth_unavailable',
  'account_exists',
  'email_unverified',
  'account_unavailable',
  'already_linked',
] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];
