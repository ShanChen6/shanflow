/**
 * Error with a stable machine-readable code and an HTTP status. The message is
 * a fixed, safe string: never put user input, tokens or hashes into it.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ValidationIssue {
  path: string;
  code: string;
}

export class RequestValidationError extends DomainError {
  constructor(readonly issues: ValidationIssue[]) {
    super('VALIDATION_FAILED', 400, 'The request is invalid.');
  }
}
