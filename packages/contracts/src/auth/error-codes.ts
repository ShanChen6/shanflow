/** Stable machine-readable error codes; clients branch on these, never on titles. */
export const AUTH_ERROR_CODES = {
  validationFailed: 'VALIDATION_FAILED',
  emailAlreadyRegistered: 'EMAIL_ALREADY_REGISTERED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  unauthenticated: 'UNAUTHENTICATED',
  csrfRejected: 'CSRF_REJECTED',
  invalidToken: 'INVALID_TOKEN',
  passwordUnchanged: 'PASSWORD_UNCHANGED',
  wrongPassword: 'WRONG_PASSWORD',
  passwordNotSet: 'PASSWORD_NOT_SET',
  oauthNotConfigured: 'OAUTH_NOT_CONFIGURED',
  tooManyRequests: 'TOO_MANY_REQUESTS',
  internalError: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
