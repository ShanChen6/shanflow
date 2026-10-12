import {
  AUTH_ERROR_CODES,
  loginRequestSchema,
  loginResponseSchema,
  type LoginRequest,
  type ProblemDetails,
} from '@shanflow/contracts';
import { postJson } from '@/shared/api/http-client';
import type { Session } from '../shared/session-store';

export type LoginField = keyof LoginRequest;
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

export type LoginOutcome =
  | { status: 'success'; session: Session }
  | { status: 'error'; fieldErrors: LoginFieldErrors; formError?: string };

const FIELD_MESSAGES: Record<LoginField, string> = {
  email: 'Enter a valid email address.',
  password: 'Enter your password.',
};

/** Client-side check with the same contract schema the API enforces. */
export function validateLogin(input: unknown): LoginFieldErrors {
  const result = loginRequestSchema.safeParse(input);
  if (result.success) return {};
  const errors: LoginFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    if (field === 'email' || field === 'password') errors[field] = FIELD_MESSAGES[field];
  }
  return errors;
}

export function mapLoginProblem(problem: ProblemDetails): Extract<LoginOutcome, { status: 'error' }> {
  switch (problem.code) {
    case AUTH_ERROR_CODES.invalidCredentials:
      // Deliberately generic: the API never says whether the email or the password was wrong.
      return { status: 'error', fieldErrors: {}, formError: 'Invalid email or password.' };
    case AUTH_ERROR_CODES.validationFailed:
      return { status: 'error', fieldErrors: {}, formError: 'Please check your email and password.' };
    case AUTH_ERROR_CODES.tooManyRequests:
      return { status: 'error', fieldErrors: {}, formError: 'Too many attempts. Please try again later.' };
    default:
      return { status: 'error', fieldErrors: {}, formError: 'Something went wrong. Please try again.' };
  }
}

export async function submitLogin(input: LoginRequest): Promise<LoginOutcome> {
  const result = await postJson('/auth/login', input, loginResponseSchema);
  if (result.ok) {
    const { accessToken, expiresIn, user } = result.data;
    return { status: 'success', session: { accessToken, expiresAt: Date.now() + expiresIn * 1000, user } };
  }
  if (result.kind === 'problem') return mapLoginProblem(result.problem);
  return { status: 'error', fieldErrors: {}, formError: 'Could not reach the server. Check your connection and try again.' };
}
