import { DomainError } from '../../../shared/errors/domain-error.js';

/** Also used for a task the caller cannot see (other workspace, deleted, not a member): existence is not revealed. */
export class TaskNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 404, 'Not found.');
  }
}

export class TaskLimitReachedError extends DomainError {
  constructor() {
    super(
      'TASK_LIMIT_REACHED',
      409,
      'This workspace has reached its task limit.',
    );
  }
}

export class TaskVersionConflictError extends DomainError {
  constructor() {
    super(
      'TASK_VERSION_CONFLICT',
      409,
      'The task was changed by someone else. Reload it and try again.',
    );
  }
}

export class InvalidStatusTransitionError extends DomainError {
  constructor() {
    super(
      'INVALID_STATUS_TRANSITION',
      409,
      'The task cannot move to that status from its current one.',
    );
  }
}

/** The assignee is not an active member of this workspace. */
export class InvalidAssigneeError extends DomainError {
  constructor() {
    super(
      'INVALID_ASSIGNEE',
      422,
      'The assignee must be an active member of this workspace.',
    );
  }
}

export class PositionCapacityExceededError extends DomainError {
  constructor() {
    super(
      'POSITION_CAPACITY_EXCEEDED',
      409,
      'The list cannot be reordered any further.',
    );
  }
}
