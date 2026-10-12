/** Stable machine-readable error codes; clients branch on these, never on titles. */
export const AUTH_ERROR_CODES = {
  validationFailed: 'VALIDATION_FAILED',
  emailAlreadyRegistered: 'EMAIL_ALREADY_REGISTERED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  projectArchived: 'PROJECT_ARCHIVED',
  projectLimitReached: 'PROJECT_LIMIT_REACHED',
  csrfRejected: 'CSRF_REJECTED',
  invalidToken: 'INVALID_TOKEN',
  passwordUnchanged: 'PASSWORD_UNCHANGED',
  wrongPassword: 'WRONG_PASSWORD',
  passwordNotSet: 'PASSWORD_NOT_SET',
  oauthNotConfigured: 'OAUTH_NOT_CONFIGURED',
  alreadyLinked: 'ALREADY_LINKED',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  invalidImage: 'INVALID_IMAGE',
  tooManyRequests: 'TOO_MANY_REQUESTS',
  internalError: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
