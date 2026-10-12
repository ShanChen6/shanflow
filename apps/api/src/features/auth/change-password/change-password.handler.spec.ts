import {
  PasswordNotSetError,
  PasswordUnchangedError,
  UnauthenticatedError,
  WrongPasswordError,
} from '../shared/auth.errors.js';
import { ChangePasswordHandler } from './change-password.handler.js';

const principal = {
  userId: 'user-1',
  sessionId: 'session-1',
  familyId: 'family-1',
};
const request = {
  currentPassword: 'the old password',
  newPassword: 'a brand new password',
};
const now = new Date('2026-10-12T00:00:00Z');

function setup(
  options: {
    user?: unknown;
    verify?: (hash: string, password: string) => boolean;
  } = {},
) {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      'user' in options
        ? options.user
        : {
            accountStatus: 'ACTIVE',
            passwordCredential: { passwordHash: '$argon2id$current' },
          },
    );
  const tx = { passwordCredential: { update } };
  const prisma = {
    user: { findUnique },
    $transaction: (callback: (client: unknown) => unknown) => callback(tx),
  };
  const verify = vi.fn(async (hash: string, password: string) =>
    (
      options.verify ??
      ((_hash, candidate) => candidate === request.currentPassword)
    )(hash, password),
  );
  const hash = vi.fn().mockResolvedValue('$argon2id$new');
  const revokeAllForUser = vi.fn().mockResolvedValue(undefined);
  const handler = new ChangePasswordHandler(
    prisma as never,
    { verify, hash } as never,
    { revokeAllForUser } as never,
    { now: () => now } as never,
  );
  return { handler, tx, update, verify, hash, revokeAllForUser };
}

describe('ChangePasswordHandler', () => {
  it('replaces the hash and revokes every other family, keeping the current device signed in', async () => {
    const { handler, tx, update, hash, revokeAllForUser } = setup();
    await handler.execute(principal, request);
    expect(hash).toHaveBeenCalledWith('a brand new password');
    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { passwordHash: '$argon2id$new', passwordUpdatedAt: now },
    });
    expect(revokeAllForUser).toHaveBeenCalledWith('user-1', {
      exceptFamilyId: 'family-1',
      tx,
    });
  });

  it('rejects a wrong current password before changing anything', async () => {
    const { handler, update, revokeAllForUser } = setup({
      verify: () => false,
    });
    await expect(handler.execute(principal, request)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(update).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one', async () => {
    const { handler, update } = setup({ verify: () => true });
    await expect(handler.execute(principal, request)).rejects.toBeInstanceOf(
      PasswordUnchangedError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('tells a password-less account to use the reset flow', async () => {
    const { handler } = setup({
      user: { accountStatus: 'ACTIVE', passwordCredential: null },
    });
    await expect(handler.execute(principal, request)).rejects.toBeInstanceOf(
      PasswordNotSetError,
    );
  });

  it('treats a missing or suspended account as unauthenticated', async () => {
    await expect(
      setup({ user: null }).handler.execute(principal, request),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      setup({
        user: {
          accountStatus: 'SUSPENDED',
          passwordCredential: { passwordHash: 'x' },
        },
      }).handler.execute(principal, request),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
