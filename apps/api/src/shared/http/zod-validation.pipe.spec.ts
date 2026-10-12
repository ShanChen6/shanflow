import { z } from 'zod';
import { RequestValidationError } from '../errors/domain-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(
  z.object({ email: z.email(), password: z.string().min(12) }),
);

describe('ZodValidationPipe', () => {
  it('returns parsed data for a valid value', () => {
    const value = {
      email: 'a@example.invalid',
      password: 'long-enough-password',
    };
    expect(pipe.transform(value)).toEqual(value);
  });

  it('throws a validation error listing paths and codes without echoing input', () => {
    const secret = 'short';
    try {
      pipe.transform({ email: 'nope', password: secret });
      expect.fail('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      const { issues } = error as RequestValidationError;
      expect(issues.map((issue) => issue.path).sort()).toEqual([
        'email',
        'password',
      ]);
      expect(JSON.stringify(issues)).not.toContain(secret);
      expect(JSON.stringify(issues)).not.toContain('nope');
    }
  });

  it('rejects a non-object body', () => {
    expect(() => pipe.transform(undefined)).toThrow(RequestValidationError);
  });
});
