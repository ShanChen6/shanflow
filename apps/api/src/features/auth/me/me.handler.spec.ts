import { UnauthenticatedError } from '../shared/auth.errors.js';
import { MeHandler } from './me.handler.js';

const principal = { userId: 'user-1', sessionId: 'session-1' };
const user = {
  id: 'user-1',
  email: 'ann@example.invalid',
  displayName: 'Ann',
  accountStatus: 'ACTIVE',
  emailVerifiedAt: null,
};

function handlerWith(found: unknown) {
  const findUnique = vi.fn().mockResolvedValue(found);
  return {
    handler: new MeHandler({ user: { findUnique } } as never),
    findUnique,
  };
}

describe('MeHandler', () => {
  it('returns only the public profile of the principal', async () => {
    const { handler, findUnique } = handlerWith(user);
    await expect(handler.execute(principal)).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'ann@example.invalid',
        displayName: 'Ann',
        emailVerified: false,
      },
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  it('reports emailVerified when a timestamp exists', async () => {
    const { handler } = handlerWith({ ...user, emailVerifiedAt: new Date() });
    expect((await handler.execute(principal)).user.emailVerified).toBe(true);
  });

  it('treats a deleted or suspended account as unauthenticated', async () => {
    await expect(
      handlerWith(null).handler.execute(principal),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      handlerWith({ ...user, accountStatus: 'SUSPENDED' }).handler.execute(
        principal,
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
