import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import { UpdateProfileHandler } from './update-profile.handler.js';

const principal = { userId: 'user-1', sessionId: 'session-1' };
const stored = {
  id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11',
  email: 'ann@example.invalid',
  emailVerifiedAt: null,
  displayName: 'New Name',
  avatarUrl: null,
  accountStatus: 'ACTIVE',
  createdAt: new Date('2026-10-12T00:00:00.000Z'),
  updatedAt: new Date('2026-10-12T02:00:00.000Z'),
};

function setup(count: number) {
  const updateMany = vi.fn().mockResolvedValue({ count });
  const findUniqueOrThrow = vi.fn().mockResolvedValue(stored);
  return {
    handler: new UpdateProfileHandler({
      user: { updateMany, findUniqueOrThrow },
    } as never),
    updateMany,
    findUniqueOrThrow,
  };
}

describe('UpdateProfileHandler', () => {
  it("updates only the display name of the token's own active account and returns the profile", async () => {
    const { handler, updateMany } = setup(1);
    const result = await handler.execute(principal, {
      displayName: 'New Name',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', accountStatus: 'ACTIVE' },
      data: { displayName: 'New Name' },
    });
    expect(result.user).toMatchObject({
      id: stored.id,
      displayName: 'New Name',
      updatedAt: '2026-10-12T02:00:00.000Z',
    });
  });

  it('treats a missing or suspended account as unauthenticated and reads nothing back', async () => {
    const { handler, findUniqueOrThrow } = setup(0);
    await expect(
      handler.execute(principal, { displayName: 'x' }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
