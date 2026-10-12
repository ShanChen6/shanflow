import type { ExecutionContext } from '@nestjs/common';
import { CsrfRejectedError } from './auth.errors.js';
import { CookieCsrfGuard } from './cookie-csrf.guard.js';

const guard = new CookieCsrfGuard({
  WEB_ORIGIN: 'https://app.example.com',
} as never);

function run(headers: Record<string, string | undefined>) {
  const request = {
    headers: { origin: headers.origin },
    get: (name: string) =>
      name.toLowerCase() === 'x-requested-with'
        ? headers['x-requested-with']
        : undefined,
  };
  return guard.canActivate({
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext);
}

describe('CookieCsrfGuard', () => {
  it('allows the web origin with the marker header', () => {
    expect(
      run({
        origin: 'https://app.example.com',
        'x-requested-with': 'shanflow',
      }),
    ).toBe(true);
  });

  it.each([
    ['no origin', { 'x-requested-with': 'shanflow' }],
    [
      'another origin',
      { origin: 'https://evil.example', 'x-requested-with': 'shanflow' },
    ],
    [
      'a look-alike origin',
      {
        origin: 'https://app.example.com.evil.example',
        'x-requested-with': 'shanflow',
      },
    ],
    ['the null origin', { origin: 'null', 'x-requested-with': 'shanflow' }],
    ['no marker header', { origin: 'https://app.example.com' }],
    [
      'a wrong marker value',
      {
        origin: 'https://app.example.com',
        'x-requested-with': 'XMLHttpRequest',
      },
    ],
  ])('rejects %s', (_name, headers) => {
    expect(() => run(headers)).toThrow(CsrfRejectedError);
  });
});
