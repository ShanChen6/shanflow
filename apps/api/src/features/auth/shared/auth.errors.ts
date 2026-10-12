import { DomainError } from '../../../shared/errors/domain-error.js';

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super(
      'EMAIL_ALREADY_REGISTERED',
      409,
      'An account with this email already exists.',
    );
  }
}

/** One error for every login failure so responses never reveal which part was wrong. */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
  }
}

/** Missing, malformed, expired or otherwise unusable access token (or its account is no longer active). */
export class UnauthenticatedError extends DomainError {
  constructor() {
    super('UNAUTHENTICATED', 401, 'Authentication is required.');
  }
}

/** A cookie-authenticated request that did not prove it came from the web app. */
export class CsrfRejectedError extends DomainError {
  constructor() {
    super('CSRF_REJECTED', 403, 'The request origin is not allowed.');
  }
}
