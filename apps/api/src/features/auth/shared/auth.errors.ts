import { DomainError } from '../../../shared/errors/domain-error.js';

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists.');
  }
}
