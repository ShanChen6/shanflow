import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { UnauthenticatedError } from './auth.errors.js';
import { CurrentPrincipal } from './current-principal.decorator.js';

class Probe {
  handler(@CurrentPrincipal() _principal: unknown) {}
}

function resolve(request: object) {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<
    string,
    { factory: (data: unknown, context: unknown) => unknown }
  >;
  const { factory } = Object.values(metadata)[0]!;
  return factory(undefined, {
    switchToHttp: () => ({ getRequest: () => request }),
  });
}

describe('CurrentPrincipal', () => {
  it('returns the principal set by the guard', () => {
    const principal = { userId: 'u', sessionId: 's' };
    expect(resolve({ principal })).toBe(principal);
  });

  it('fails closed when no guard populated the request', () => {
    expect(() => resolve({})).toThrow(UnauthenticatedError);
  });
});
