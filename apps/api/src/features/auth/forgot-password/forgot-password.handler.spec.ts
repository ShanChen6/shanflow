import { ForgotPasswordHandler } from './forgot-password.handler.js';

function setup(
  user: unknown,
  issue = vi.fn().mockResolvedValue('t'.repeat(43)),
) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const sendPasswordReset = vi.fn();
  const handler = new ForgotPasswordHandler(
    { user: { findUnique } } as never,
    { issue } as never,
    { sendPasswordReset } as never,
  );
  return { handler, findUnique, issue, sendPasswordReset };
}

describe('ForgotPasswordHandler', () => {
  it('looks up the canonical email and emails a reset link to an active account', async () => {
    const { handler, findUnique, issue, sendPasswordReset } = setup({
      id: 'user-1',
      email: 'ann@example.invalid',
      accountStatus: 'ACTIVE',
    });
    await handler.execute({ email: '  Ann@Example.INVALID ' });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ann@example.invalid' } }),
    );
    expect(issue).toHaveBeenCalledWith('user-1', 'PASSWORD_RESET');
    expect(sendPasswordReset).toHaveBeenCalledWith(
      'ann@example.invalid',
      't'.repeat(43),
    );
  });

  it.each([
    ['an unknown address', null],
    [
      'a suspended account',
      { id: 'user-1', email: 'a@b.io', accountStatus: 'SUSPENDED' },
    ],
  ])('does nothing, and does not fail, for %s', async (_name, user) => {
    const { handler, issue, sendPasswordReset } = setup(user);
    await expect(handler.execute({ email: 'a@b.io' })).resolves.toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it('never reveals an internal failure to the caller', async () => {
    const { handler, sendPasswordReset } = setup(
      { id: 'user-1', email: 'a@b.io', accountStatus: 'ACTIVE' },
      vi.fn().mockRejectedValue(new Error('db down')),
    );
    await expect(handler.execute({ email: 'a@b.io' })).resolves.toBeUndefined();
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });
});
