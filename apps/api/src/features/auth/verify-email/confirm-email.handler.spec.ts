import { InvalidTokenError } from '../shared/auth.errors.js';
import { ConfirmEmailHandler } from './confirm-email.handler.js';

const request = { token: 'A'.repeat(43) };
const now = new Date('2026-10-12T00:00:00Z');

function setup(options: { claimed?: unknown; user?: unknown } = {}) {
  const update = vi.fn().mockResolvedValue({});
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
  const tx = { user: { findUnique, update } };
  const prisma = {
    $transaction: (callback: (client: unknown) => unknown) => callback(tx),
  };
  const consume = vi
    .fn()
    .mockResolvedValue(
      'claimed' in options
        ? options.claimed
        : { userId: 'user-1', email: 'ann@example.invalid' },
    );
  const handler = new ConfirmEmailHandler(
    prisma as never,
    { consume } as never,
    { now: () => now } as never,
  );
  return { handler, consume, update };
}

describe('ConfirmEmailHandler', () => {
  it('claims the token for the verification purpose and marks the email verified', async () => {
    const { handler, consume, update } = setup();
    await handler.execute(request);
    expect(consume).toHaveBeenCalledWith(
      expect.anything(),
      request.token,
      'EMAIL_VERIFICATION',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerifiedAt: now },
    });
  });

  it('rejects an unknown, expired or used token', async () => {
    const { handler, update } = setup({ claimed: null });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a link bound to an email the account no longer has', async () => {
    const { handler, update } = setup({
      user: {
        email: 'new@example.invalid',
        accountStatus: 'ACTIVE',
        emailVerifiedAt: null,
      },
    });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects suspended and missing accounts', async () => {
    await expect(
      setup({
        user: {
          email: 'ann@example.invalid',
          accountStatus: 'SUSPENDED',
          emailVerifiedAt: null,
        },
      }).handler.execute(request),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(
      setup({ user: null }).handler.execute(request),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('does not rewrite an existing verification timestamp', async () => {
    const { handler, update } = setup({
      user: {
        email: 'ann@example.invalid',
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date('2026-01-01'),
      },
    });
    await handler.execute(request);
    expect(update).not.toHaveBeenCalled();
  });
});
