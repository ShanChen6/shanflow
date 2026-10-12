import { UnauthenticatedError } from '../shared/auth.errors.js';
import { RefreshHandler } from './refresh.handler.js';

const session = {
  token: 'new-raw',
  sessionId: 'session-2',
  familyId: 'family-1',
  expiresAt: new Date('2026-11-11T00:00:00Z'),
};
const user = {
  id: 'user-1',
  email: 'ann@example.invalid',
  displayName: 'Ann',
  emailVerified: false,
};

function setup(rotation: unknown) {
  const rotate = vi.fn().mockResolvedValue(rotation);
  const sign = vi.fn().mockResolvedValue({ token: 'jwt', expiresIn: 900 });
  return {
    handler: new RefreshHandler({ rotate } as never, { sign } as never),
    rotate,
    sign,
  };
}

describe('RefreshHandler', () => {
  it('issues an access token bound to the new session and returns the new refresh session', async () => {
    const { handler, rotate, sign } = setup({
      status: 'rotated',
      session,
      user,
    });
    const result = await handler.execute('old-raw');
    expect(rotate).toHaveBeenCalledWith('old-raw');
    expect(sign).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-2',
    });
    expect(result.refreshSession).toBe(session);
    expect(result.body).toEqual({
      accessToken: 'jwt',
      tokenType: 'Bearer',
      expiresIn: 900,
      user,
    });
    expect(JSON.stringify(result.body)).not.toContain('new-raw');
  });

  it.each([['invalid'], ['reuse']])(
    'fails with the same error for a %s rotation',
    async (status) => {
      const { handler, sign } = setup({ status });
      await expect(handler.execute('old-raw')).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      expect(sign).not.toHaveBeenCalled();
    },
  );

  it('fails without touching the store when there is no cookie', async () => {
    const { handler, rotate } = setup({ status: 'rotated', session, user });
    await expect(handler.execute(undefined)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(handler.execute('')).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(rotate).not.toHaveBeenCalled();
  });
});
