import { getUserMeResponseSchema } from '@shanflow/contracts';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import { GetMeHandler, safeAvatarUrl } from './me.handler.js';

const principal = { userId: 'user-1', sessionId: 'session-1' };
const stored = {
  id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11',
  email: 'ann@example.invalid',
  emailVerifiedAt: null,
  displayName: 'Ann',
  avatarUrl: null,
  accountStatus: 'ACTIVE',
  createdAt: new Date('2026-10-12T00:00:00.000Z'),
  updatedAt: new Date('2026-10-12T01:00:00.000Z'),
};

function setup(found: unknown) {
  const findUnique = vi.fn().mockResolvedValue(found);
  return {
    handler: new GetMeHandler({ user: { findUnique } } as never),
    findUnique,
  };
}

describe('GetMeHandler', () => {
  it('looks the user up by the id in the token and returns a contract-valid profile', async () => {
    const { handler, findUnique } = setup(stored);
    const result = await handler.execute(principal);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(result).toEqual({
      user: {
        id: stored.id,
        email: 'ann@example.invalid',
        emailVerified: false,
        displayName: 'Ann',
        avatarUrl: null,
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T01:00:00.000Z',
      },
    });
    expect(getUserMeResponseSchema.safeParse(result).success).toBe(true);
  });

  it('selects an explicit allow-list that never includes credentials', async () => {
    const { handler, findUnique } = setup(stored);
    await handler.execute(principal);
    const select = (
      findUnique.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(Object.keys(select).sort()).toEqual([
      'accountStatus',
      'avatarUrl',
      'createdAt',
      'displayName',
      'email',
      'emailVerifiedAt',
      'id',
      'updatedAt',
    ]);
    expect(select).not.toHaveProperty('passwordCredential');
  });

  it('reports a verified email and keeps a safe avatar', async () => {
    const { handler } = setup({
      ...stored,
      emailVerifiedAt: new Date(),
      avatarUrl: 'https://images.example.invalid/a.png',
    });
    const { user } = await handler.execute(principal);
    expect(user.emailVerified).toBe(true);
    expect(user.avatarUrl).toBe('https://images.example.invalid/a.png');
  });

  it('treats a deleted or suspended account as unauthenticated', async () => {
    await expect(setup(null).handler.execute(principal)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      setup({ ...stored, accountStatus: 'SUSPENDED' }).handler.execute(
        principal,
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('safeAvatarUrl', () => {
  it('passes https URLs and drops everything else', () => {
    expect(safeAvatarUrl('https://images.example.invalid/a.png')).toBe(
      'https://images.example.invalid/a.png',
    );
    for (const unsafe of [
      null,
      '',
      'http://images.example.invalid/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'not a url',
      '//images.example.invalid/a.png',
    ]) {
      expect(safeAvatarUrl(unsafe)).toBeNull();
    }
  });
});
