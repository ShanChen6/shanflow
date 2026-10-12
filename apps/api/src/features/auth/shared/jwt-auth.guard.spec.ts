import type { ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from './auth.errors.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const claims = { userId: 'user-1', sessionId: 'session-1' };

function setup(verified: typeof claims | null = claims) {
  const verify = vi.fn().mockResolvedValue(verified);
  const guard = new JwtAuthGuard({ verify } as never);
  const run = (authorization?: unknown) => {
    const request: Record<string, unknown> = { headers: { authorization } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  };
  return { verify, run };
}

describe('JwtAuthGuard', () => {
  it('accepts a Bearer token, verifies it and exposes the principal', async () => {
    const { verify, run } = setup();
    const { request, result } = run('Bearer abc.def.ghi');
    await expect(result).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('abc.def.ghi');
    expect(request.principal).toEqual(claims);
  });

  it('treats the scheme as case-insensitive', async () => {
    await expect(setup().run('bearer abc.def.ghi').result).resolves.toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['empty header', ''],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['scheme only', 'Bearer'],
    ['empty token', 'Bearer '],
    ['extra segments', 'Bearer a b'],
    ['illegal characters', 'Bearer a$b'],
    ['an oversized token', `Bearer ${'a'.repeat(2049)}`],
    ['a non-string header', ['Bearer abc']],
  ])('rejects %s without verifying', async (_name, header) => {
    const { verify, run } = setup();
    const { request, result } = run(header);
    await expect(result).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(verify).not.toHaveBeenCalled();
    expect(request.principal).toBeUndefined();
  });

  it('rejects a token that fails verification and sets no principal', async () => {
    const { request, result } = setup(null).run('Bearer abc.def.ghi');
    await expect(result).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(request.principal).toBeUndefined();
  });
});
