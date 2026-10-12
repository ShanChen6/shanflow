import { DomainError } from '../../shared/errors/domain-error.js';

export class ProjectNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 404, 'Not found.');
  }
}

export class ProjectArchivedError extends DomainError {
  constructor() {
    super(
      'PROJECT_ARCHIVED',
      409,
      'The project is archived. Restore it before changing it.',
    );
  }
}

export class ProjectLimitReachedError extends DomainError {
  constructor() {
    super(
      'PROJECT_LIMIT_REACHED',
      409,
      'This workspace has reached its project limit.',
    );
  }
}
