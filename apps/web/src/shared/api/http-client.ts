import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, problemDetailsSchema, type ProblemDetails } from '@shanflow/contracts';
import type { ZodType } from 'zod';
import { API_BASE_URL } from '../config';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'problem'; problem: ProblemDetails }
  // Network failure, or a response that does not match the contract.
  | { ok: false; kind: 'unavailable' };

interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  schema: ZodType<T>;
  body?: unknown;
  accessToken?: string;
  /** Lets the request (and its Set-Cookie) complete even if the page unloads mid-flight. */
  keepalive?: boolean;
}

/**
 * Calls the API and validates the response against the slice contract. Never throws: callers branch
 * on the result. Cookies are always sent (the refresh cookie is scoped to /auth by the server).
 * POSTs carry the CSRF marker header required by cookie-authenticated endpoints.
 */
export async function requestJson<T>({ method, path, schema, body, accessToken, keepalive }: RequestOptions<T>): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (method === 'POST') headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(keepalive ? { keepalive: true } : {}),
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, kind: 'unavailable' };
  }

  if (response.ok) {
    const parsed = schema.safeParse(payload);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, kind: 'unavailable' };
  }
  const problem = problemDetailsSchema.safeParse(payload);
  return problem.success ? { ok: false, kind: 'problem', problem: problem.data } : { ok: false, kind: 'unavailable' };
}

export function postJson<T>(path: string, body: unknown, schema: ZodType<T>, options: { keepalive?: boolean } = {}): Promise<ApiResult<T>> {
  return requestJson({ method: 'POST', path, body, schema, ...options });
}

/** For endpoints that answer 204 No Content on success (logout). Failures are problem+json as usual. */
export async function requestNoContent(options: Omit<RequestOptions<never>, 'schema'>): Promise<ApiResult<void>> {
  const { method, path, body, accessToken, keepalive } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (method === 'POST') headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(keepalive ? { keepalive: true } : {}),
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.ok) return { ok: true, data: undefined };
  const problem = problemDetailsSchema.safeParse(await response.json().catch(() => undefined));
  return problem.success ? { ok: false, kind: 'problem', problem: problem.data } : { ok: false, kind: 'unavailable' };
}
