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
