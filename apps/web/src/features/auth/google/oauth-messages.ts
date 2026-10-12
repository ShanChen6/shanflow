import { OAUTH_ERROR_CODES, type OAuthErrorCode } from '@shanflow/contracts';

const MESSAGES: Record<OAuthErrorCode, string> = {
  oauth_failed: 'Google sign-in failed. Please try again.',
  oauth_cancelled: 'Google sign-in was cancelled.',
  oauth_unavailable: 'Google sign-in is not available right now.',
  account_exists:
    'An account with this email already exists. Sign in with your password, then link Google from your account page.',
  email_unverified: 'Your Google email address is not verified, so it cannot be used to sign in.',
  account_unavailable: 'This account cannot sign in right now.',
  already_linked: 'That Google account is already linked to a different account.',
};

/** Only known codes are mapped: arbitrary `?error=` text is never rendered. */
export function messageForOAuthError(code: string | null | undefined): string | undefined {
  return (OAUTH_ERROR_CODES as readonly string[]).includes(code ?? '') ? MESSAGES[code as OAuthErrorCode] : undefined;
}
