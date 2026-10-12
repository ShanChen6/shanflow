import { problemDetailsSchema, type ProblemDetails } from '@shanflow/contracts';
import type { ZodType } from 'zod';
import { API_BASE_URL } from '../config';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'problem'; problem: ProblemDetails }
  // Network failure, or a response that does not match the contract.
  | { ok: false; kind: 'unavailable' };

/**
 * POSTs JSON to the API and validates the response against the slice contract.
 * Never throws: callers branch on the result. Cookies are sent so the refresh
 * session works once login exists.
 */
export async function postJson<T>(path: string, body: unknown, responseSchema: ZodType<T>): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    const parsed = responseSchema.safeParse(payload);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, kind: 'unavailable' };
  }
  const problem = problemDetailsSchema.safeParse(payload);
  return problem.success ? { ok: false, kind: 'problem', problem: problem.data } : { ok: false, kind: 'unavailable' };
}
