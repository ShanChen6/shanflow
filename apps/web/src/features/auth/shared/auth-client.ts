import { meResponseSchema, refreshResponseSchema, AUTH_ERROR_CODES, type MeResponse } from '@shanflow/contracts';
import type { ZodType } from 'zod';
import { requestJson, requestNoContent, postJson, type ApiResult } from '@/shared/api/http-client';
import { clearSession, getSession, sessionFromResponse, setSession, type Session } from './session-store';

export type RefreshOutcome =
  | { status: 'ok'; session: Session }
  /** The server rejected the refresh token (or none exists): the user must sign in. */
  | { status: 'signed-out' }
  /** Network failure, throttling or an unexpected response: the session state is unchanged. */
  | { status: 'unavailable' };

const LOCK_NAME = 'shanflow-refresh';
// Refresh a little before expiry so a request does not race the token's last seconds.
const EXPIRY_MARGIN_MS = 10_000;

/**
 * Refresh tokens are single-use and a reused one revokes the whole session, so two refreshes must never
 * run with the same cookie at once. Web Locks serializes them across tabs; the second tab then reads the
 * cookie the first tab already rotated.
 */
async function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(LOCK_NAME, task) : task();
}

async function runRefresh(): Promise<RefreshOutcome> {
  return withCrossTabLock(async () => {
    // keepalive: a refresh token is single-use, so if the user reloads mid-request the server-side
    // rotation must still reach the browser's cookie jar, or the next load would look like token theft.
    const result = await postJson('/auth/refresh', undefined, refreshResponseSchema, { keepalive: true });
    if (result.ok) {
      const session = sessionFromResponse(result.data);
      setSession(session);
      return { status: 'ok', session };
    }
    if (result.kind === 'problem' && result.problem.code === AUTH_ERROR_CODES.unauthenticated) {
      clearSession();
      return { status: 'signed-out' };
    }
    return { status: 'unavailable' };
  });
}

let inFlight: Promise<RefreshOutcome> | null = null;

/** Single-flight within a tab: concurrent callers share one network request. */
export function refreshSession(): Promise<RefreshOutcome> {
  inFlight ??= runRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export type AuthedResult<T> = ApiResult<T> | { ok: false; kind: 'signed-out' };

const isExpiring = (session: Session) => session.expiresAt - Date.now() <= EXPIRY_MARGIN_MS;
const isUnauthenticated = (result: ApiResult<unknown>) =>
  !result.ok && result.kind === 'problem' && result.problem.code === AUTH_ERROR_CODES.unauthenticated;

/**
 * Runs an API call with the in-memory access token; refreshes first when it is missing or about to
 * expire, and retries exactly once after a 401 (e.g. a revoked session). Never loops.
 */
async function withAccessToken<T>(call: (accessToken: string) => Promise<ApiResult<T>>): Promise<AuthedResult<T>> {
  let session = getSession();
  if (!session || isExpiring(session)) {
    const refreshed = await refreshSession();
    if (refreshed.status === 'signed-out') return { ok: false, kind: 'signed-out' };
    if (refreshed.status === 'unavailable') return { ok: false, kind: 'unavailable' };
    session = refreshed.session;
  }

  const result = await call(session.accessToken);
  if (!isUnauthenticated(result)) return result;

  const refreshed = await refreshSession();
  if (refreshed.status === 'signed-out') return { ok: false, kind: 'signed-out' };
  if (refreshed.status === 'unavailable') return { ok: false, kind: 'unavailable' };
  return call(refreshed.session.accessToken);
}

export function authedGetJson<T>(path: string, schema: ZodType<T>): Promise<AuthedResult<T>> {
  return withAccessToken((accessToken) => requestJson({ method: 'GET', path, schema, accessToken }));
}

/** Authenticated POST that answers 204 (logout-all). */
export function authedPostNoContent(path: string): Promise<AuthedResult<void>> {
  return withAccessToken((accessToken) => requestNoContent({ method: 'POST', path, accessToken }));
}

/** Ends this device's session: the refresh cookie authenticates the request. */
export function postLogout(): Promise<ApiResult<void>> {
  // keepalive so the revocation completes even if the page navigates away right after.
  return requestNoContent({ method: 'POST', path: '/auth/logout', keepalive: true });
}

export function fetchMe(): Promise<AuthedResult<MeResponse>> {
  return authedGetJson('/auth/me', meResponseSchema);
}
