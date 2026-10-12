import { meResponseSchema, refreshResponseSchema, AUTH_ERROR_CODES, type MeResponse } from '@shanflow/contracts';
import type { ZodType } from 'zod';
import { requestJson, postJson, type ApiResult } from '@/shared/api/http-client';
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

/** GET with the in-memory access token; refreshes first when missing/expiring and retries once on 401. */
export async function authedGetJson<T>(path: string, schema: ZodType<T>): Promise<AuthedResult<T>> {
  let session = getSession();
  if (!session || isExpiring(session)) {
    const refreshed = await refreshSession();
    if (refreshed.status === 'signed-out') return { ok: false, kind: 'signed-out' };
    if (refreshed.status === 'unavailable') return { ok: false, kind: 'unavailable' };
    session = refreshed.session;
  }

  const result = await requestJson({ method: 'GET', path, schema, accessToken: session.accessToken });
  if (!isUnauthenticated(result)) return result;

  // The server did not accept the token (e.g. revoked): one refresh, one retry, never a loop.
  const refreshed = await refreshSession();
  if (refreshed.status === 'signed-out') return { ok: false, kind: 'signed-out' };
  if (refreshed.status === 'unavailable') return { ok: false, kind: 'unavailable' };
  return requestJson({ method: 'GET', path, schema, accessToken: refreshed.session.accessToken });
}

export function fetchMe(): Promise<AuthedResult<MeResponse>> {
  return authedGetJson('/auth/me', meResponseSchema);
}
