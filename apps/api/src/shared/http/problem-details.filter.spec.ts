import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  type ArgumentsHost,
} from '@nestjs/common';
import { DomainError, RequestValidationError } from '../errors/domain-error.js';
import { ProblemDetailsFilter, toProblem } from './problem-details.filter.js';

describe('problem details mapping', () => {
  it('maps domain errors to their code and status', () => {
    expect(
      toProblem(
        new DomainError('INVALID_CREDENTIALS', 401, 'Invalid credentials.'),
      ),
    ).toEqual({
      type: 'urn:shanflow:problem:invalid-credentials',
      title: 'Invalid credentials.',
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('includes validation issues', () => {
    const problem = toProblem(
      new RequestValidationError([{ path: 'email', code: 'invalid_format' }]),
    );
    expect(problem).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'email', code: 'invalid_format' }],
    });
  });

  it('maps framework HTTP exceptions without exposing their message', () => {
    expect(toProblem(new ForbiddenException('secret detail'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    const problem = toProblem(new BadRequestException('leak'));
    expect(JSON.stringify(problem)).not.toContain('leak');
  });

  it('turns unknown errors into a generic 500 with no message or stack', () => {
    const problem = toProblem(new Error('password=hunter2 at /srv/app.ts'));
    expect(problem).toEqual({
      type: 'urn:shanflow:problem:internal-error',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(toProblem('string failure').status).toBe(500);
  });

  it('writes application/problem+json with the mapped status', () => {
    const calls: unknown[] = [];
    const response = {
      status(code: number) {
        calls.push(['status', code]);
        return response;
      },
      type(value: string) {
        calls.push(['type', value]);
        return response;
      },
      json(body: unknown) {
        calls.push(['json', body]);
        return response;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new ProblemDetailsFilter().catch(
      new DomainError('CONFLICT', 409, 'Conflict.'),
      host,
    );
    expect(calls).toEqual([
      ['status', 409],
      ['type', 'application/problem+json'],
      ['json', expect.objectContaining({ code: 'CONFLICT', status: 409 })],
    ]);
  });

  it('advertises Bearer authentication on 401 only', () => {
    const run = (error: DomainError) => {
      const headers: string[] = [];
      const response = {
        setHeader: (name: string) => headers.push(name),
        status: () => response,
        type: () => response,
        json: () => response,
      };
      const host = {
        switchToHttp: () => ({ getResponse: () => response }),
      } as unknown as ArgumentsHost;
      new ProblemDetailsFilter().catch(error, host);
      return headers;
    };
    expect(run(new DomainError('UNAUTHENTICATED', 401, 'x'))).toEqual([
      'WWW-Authenticate',
    ]);
    expect(run(new DomainError('CONFLICT', 409, 'x'))).toEqual([]);
  });
});

describe('DomainErrorFilter', () => {
  it('is scoped to DomainError and reuses the problem+json mapping', async () => {
    const { DomainErrorFilter } = await import('./problem-details.filter.js');
    const caught = Reflect.getMetadata(
      '__filterCatchExceptions__',
      DomainErrorFilter,
    ) as unknown[];
    expect(caught).toEqual([DomainError]);
    expect(new DomainErrorFilter()).toBeInstanceOf(ProblemDetailsFilter);
  });
});
