import { authedPostNoContent, postLogout } from '../shared/auth-client';
import { markSignedOut } from '../shared/bootstrap-store';
import { clearSession } from '../shared/session-store';

export type LogoutScope = 'device' | 'everywhere';
export type LogoutOutcome = { status: 'signed-out' } | { status: 'failed'; message: string };

const FAILURE_MESSAGE = 'Could not sign out. Check your connection and try again.';

function finishSignOut(): LogoutOutcome {
  // Order matters: mark first so mounted pages redirect instead of trying to restore a revoked session.
  markSignedOut();
  clearSession();
  return { status: 'signed-out' };
}

/**
 * Signs out only after the server confirmed. If the server could not be reached the refresh cookie is
 * still valid, so clearing local state would be misleading: the next page load would sign the user back in.
 */
export async function submitLogout(scope: LogoutScope): Promise<LogoutOutcome> {
  if (scope === 'device') {
    const result = await postLogout();
    return result.ok ? finishSignOut() : { status: 'failed', message: FAILURE_MESSAGE };
  }
  const result = await authedPostNoContent('/auth/logout-all');
  // 'signed-out' means the session was already gone, which is the state the user asked for.
  if (result.ok || result.kind === 'signed-out') return finishSignOut();
  return { status: 'failed', message: FAILURE_MESSAGE };
}
