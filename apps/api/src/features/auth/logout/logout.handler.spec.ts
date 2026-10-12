import { LogoutHandler } from './logout.handler.js';

function setup() {
  const revokeFamilyByToken = vi.fn().mockResolvedValue(true);
  const revokeAllForUser = vi.fn().mockResolvedValue(undefined);
  return {
    handler: new LogoutHandler({
      revokeFamilyByToken,
      revokeAllForUser,
    } as never),
    revokeFamilyByToken,
    revokeAllForUser,
  };
}

describe('LogoutHandler', () => {
  it('revokes the family of the presented refresh token', async () => {
    const { handler, revokeFamilyByToken } = setup();
    await handler.logout('raw-token');
    expect(revokeFamilyByToken).toHaveBeenCalledWith('raw-token');
  });

  it('succeeds without touching the store when there is no cookie', async () => {
    const { handler, revokeFamilyByToken } = setup();
    await expect(handler.logout(undefined)).resolves.toBeUndefined();
    await expect(handler.logout('')).resolves.toBeUndefined();
    expect(revokeFamilyByToken).not.toHaveBeenCalled();
  });

  it('revokes all sessions of the principal user only', async () => {
    const { handler, revokeAllForUser } = setup();
    await handler.logoutAll({ userId: 'user-1', sessionId: 'session-1' });
    expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
  });
});
