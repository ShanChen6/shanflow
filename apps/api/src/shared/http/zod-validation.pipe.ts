import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { RequestValidationError } from '../errors/domain-error.js';

/** Validates a body/query/params value against a slice's zod schema. */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    // Report only the location and rule: messages/inputs can echo secrets such as passwords.
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    );
  }
}
