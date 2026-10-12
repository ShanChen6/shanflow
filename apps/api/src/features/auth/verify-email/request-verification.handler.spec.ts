import { UnauthenticatedError } from '../shared/auth.errors.js';
import { RequestVerificationHandler } from './request-verification.handler.js';

const principal = { userId: 'user-1', sessionId: 'session-1' };

function setup(user: unknown) {
  const send = vi.fn().mockResolvedValue(undefined);
  const handler = new RequestVerificationHandler(
    { user: { findUnique: vi.fn().mockResolvedValue(user) } } as never,
    { send } as never,
  );
  return { handler, send };
}

describe('RequestVerificationHandler', () => {
  it('sends a link to an unverified active account', async () => {
    const user = {
      id: 'user-1',
      email: 'ann@example.invalid',
      accountStatus: 'ACTIVE',
      emailVerifiedAt: null,
    };
    const { handler, send } = setup(user);
    await handler.execute(principal);
    expect(send).toHaveBeenCalledWith(user);
  });

  it('does nothing for an already verified account', async () => {
    const { handler, send } = setup({
      id: 'user-1',
      email: 'a@b.io',
      accountStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });
    await expect(handler.execute(principal)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('treats missing and suspended accounts as unauthenticated', async () => {
    await expect(setup(null).handler.execute(principal)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      setup({
        id: 'user-1',
        email: 'a@b.io',
        accountStatus: 'SUSPENDED',
        emailVerifiedAt: null,
      }).handler.execute(principal),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
