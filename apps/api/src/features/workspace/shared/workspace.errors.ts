import { DomainError } from '../../../shared/errors/domain-error.js';

/** Also used for a workspace the caller is not (or no longer) a member of: existence is not revealed. */
export class WorkspaceNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 404, 'Not found.');
  }
}

export class ForbiddenError extends DomainError {
  constructor() {
    super('FORBIDDEN', 403, 'You do not have permission to do that.');
  }
}
