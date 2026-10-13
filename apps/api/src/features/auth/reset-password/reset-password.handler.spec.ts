import { InvalidTokenError } from '../shared/auth.errors.js';
import { ResetPasswordHandler } from './reset-password.handler.js';

const request = { token: 'A'.repeat(43), newPassword: 'a brand new password' };
const now = new Date('2026-10-12T00:00:00Z');

function setup(options: { claimed?: unknown; user?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({});
  const userUpdate = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      'user' in options
        ? options.user
        : {
            email: 'ann@example.invalid',
            accountStatus: 'ACTIVE',
            emailVerifiedAt: null,
          },
    );
  const tx = {
    user: { findUnique, update: userUpdate },
    passwordCredential: { upsert },
    oneTimeToken: { deleteMany },
  };
  const prisma = {
    $transaction: (callback: (client: unknown) => unknown) => callback(tx),
  };
  const consume = vi
    .fn()
    .mockResolvedValue(
      'claimed' in options
        ? options.claimed
        : { userId: 'user-1', email: null },
    );
  const revokeAllForUser = vi.fn().mockResolvedValue(undefined);
  const hash = vi.fn().mockResolvedValue('$argon2id$new');
  const sendPasswordChanged = vi.fn();
  const handler = new ResetPasswordHandler(
    prisma as never,
    { consume } as never,
    { revokeAllForUser } as never,
    { hash } as never,
    { now: () => now } as never,
    { sendPasswordChanged } as never,
  );
  return {
    handler,
    sendPasswordChanged,
    tx,
    consume,
    upsert,
    userUpdate,
    deleteMany,
    revokeAllForUser,
    hash,
  };
}

describe('ResetPasswordHandler', () => {
  it('replaces the password, verifies the email, drops other reset links and revokes every session in one transaction', async () => {
    const {
      handler,
      tx,
      consume,
      upsert,
      userUpdate,
      deleteMany,
      revokeAllForUser,
      hash,
    } = setup();
    await handler.execute(request);
    expect(hash).toHaveBeenCalledWith('a brand new password');
    expect(consume).toHaveBeenCalledWith(tx, request.token, 'PASSWORD_RESET');
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        passwordHash: '$argon2id$new',
        passwordUpdatedAt: now,
      },
      update: { passwordHash: '$argon2id$new', passwordUpdatedAt: now },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerifiedAt: now },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', purpose: 'PASSWORD_RESET', usedAt: null },
    });
    expect(revokeAllForUser).toHaveBeenCalledWith('user-1', { tx });
  });

  it('keeps an existing verification timestamp', async () => {
    const { handler, userUpdate } = setup({
      user: {
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date('2026-01-01'),
      },
    });
    await handler.execute(request);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid token without changing anything', async () => {
    const { handler, upsert, revokeAllForUser } = setup({ claimed: null });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('rejects a suspended or missing account without changing anything', async () => {
    for (const user of [
      { accountStatus: 'SUSPENDED', emailVerifiedAt: null },
      null,
    ]) {
      const { handler, upsert } = setup({ user });
      await expect(handler.execute(request)).rejects.toBeInstanceOf(
        InvalidTokenError,
      );
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it('notifies the owner after a successful reset and sends nothing for a rejected one', async () => {
    const ok = setup();
    await ok.handler.execute(request);
    expect(ok.sendPasswordChanged).toHaveBeenCalledWith(
      'ann@example.invalid',
      'reset',
    );

    const rejected = setup({ claimed: null });
    await expect(rejected.handler.execute(request)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(rejected.sendPasswordChanged).not.toHaveBeenCalled();
  });
});
