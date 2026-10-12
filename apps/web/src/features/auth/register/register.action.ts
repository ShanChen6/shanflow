import {
  AUTH_ERROR_CODES,
  registerRequestSchema,
  registerResponseSchema,
  type ProblemDetails,
  type RegisterRequest,
  type RegisterResponse,
} from '@shanflow/contracts';
import { postJson } from '@/shared/api/http-client';

export type RegisterField = keyof RegisterRequest;
export type RegisterFieldErrors = Partial<Record<RegisterField, string>>;

export type RegisterOutcome =
  | { status: 'success'; user: RegisterResponse['user'] }
  | { status: 'error'; fieldErrors: RegisterFieldErrors; formError?: string };

const FIELD_MESSAGES: Record<RegisterField, string> = {
  email: 'Enter a valid email address.',
  password: 'Use 12 to 128 characters.',
  displayName: 'Enter a name of up to 80 characters.',
};

const isField = (value: string): value is RegisterField => value in FIELD_MESSAGES;

/** Field errors from a zod issue list (client check or server VALIDATION_FAILED). */
export function fieldErrorsFromPaths(paths: string[]): RegisterFieldErrors {
  const errors: RegisterFieldErrors = {};
  for (const path of paths) {
    const field = path.split('.')[0] ?? '';
    if (isField(field)) errors[field] = FIELD_MESSAGES[field];
  }
  return errors;
}

/** Client-side check with the same contract schema the API enforces. */
export function validateRegistration(input: unknown): RegisterFieldErrors {
  const result = registerRequestSchema.safeParse(input);
  return result.success ? {} : fieldErrorsFromPaths(result.error.issues.map((issue) => issue.path.join('.')));
}

export function mapRegisterProblem(problem: ProblemDetails): Extract<RegisterOutcome, { status: 'error' }> {
  switch (problem.code) {
    case AUTH_ERROR_CODES.emailAlreadyRegistered:
      return { status: 'error', fieldErrors: { email: 'An account with this email already exists.' } };
    case AUTH_ERROR_CODES.validationFailed:
      return {
        status: 'error',
        fieldErrors: fieldErrorsFromPaths((problem.issues ?? []).map((issue) => issue.path)),
        formError: 'Please check the highlighted fields.',
      };
    case AUTH_ERROR_CODES.tooManyRequests:
      return { status: 'error', fieldErrors: {}, formError: 'Too many attempts. Please try again later.' };
    default:
      return { status: 'error', fieldErrors: {}, formError: 'Something went wrong. Please try again.' };
  }
}

export async function submitRegistration(input: RegisterRequest): Promise<RegisterOutcome> {
  const result = await postJson('/auth/register', input, registerResponseSchema);
  if (result.ok) return { status: 'success', user: result.data.user };
  if (result.kind === 'problem') return mapRegisterProblem(result.problem);
  return { status: 'error', fieldErrors: {}, formError: 'Could not reach the server. Check your connection and try again.' };
}
