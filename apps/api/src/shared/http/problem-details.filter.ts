import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, RequestValidationError } from '../errors/domain-error.js';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  issues?: Array<{ path: string; code: string }>;
}

const GENERIC_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Maps every failure to an RFC 9457 problem+json body. Unknown errors become a
 * generic 500: messages, stacks and driver details are never sent to clients.
 */
export function toProblem(exception: unknown): ProblemDetails {
  if (exception instanceof RequestValidationError) {
    return problem(
      exception.httpStatus,
      exception.code,
      exception.message,
      exception.issues,
    );
  }
  if (exception instanceof DomainError) {
    return problem(exception.httpStatus, exception.code, exception.message);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code =
      GENERIC_CODES[status] ??
      (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
    return problem(
      status,
      code,
      HttpStatus[status]?.replaceAll('_', ' ') ?? 'Request failed',
    );
  }
  return problem(500, 'INTERNAL_ERROR', 'Internal server error');
}

function problem(
  status: number,
  code: string,
  title: string,
  issues?: ProblemDetails['issues'],
): ProblemDetails {
  return {
    type: `urn:shanflow:problem:${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    ...(issues ? { issues } : {}),
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toProblem(exception);
    const response = host.switchToHttp().getResponse<Response>();
    response.status(body.status).type('application/problem+json').json(body);
  }
}
