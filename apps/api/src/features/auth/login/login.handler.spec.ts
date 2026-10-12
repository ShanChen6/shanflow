import { InvalidCredentialsError } from '../shared/auth.errors.js';
import { LoginHandler } from './login.handler.js';

const request = {
  email: ' Ann@Example.INVALID ',
  password: 'correct horse battery',
};
const user = {
  id: 'user-1',
  email: 'ann@example.invalid',
  displayName: 'Ann',
  accountStatus: 'ACTIVE',
  emailVerifiedAt: null,
  passwordCredential: { userId: 'user-1', passwordHash: '$argon2id$stored' },
};
const refreshSession = {
  token: 'raw-refresh',
  sessionId: 'session-1',
  familyId: 'family-1',
  expiresAt: new Date('2026-11-11T00:00:00Z'),
};

function setup(
  overrides: {
    user?: unknown;
    verify?: boolean;
    needsRehash?: boolean;
    update?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const findUnique = vi
    .fn()
    .mockResolvedValue('user' in overrides ? overrides.user : user);
  const update = overrides.update ?? vi.fn().mockResolvedValue({});
  const hasher = {
    verify: vi.fn().mockResolvedValue(overrides.verify ?? true),
    verifyDummy: vi.fn().mockResolvedValue(undefined),
    needsRehash: vi.fn().mockReturnValue(overrides.needsRehash ?? false),
    hash: vi.fn().mockResolvedValue('$argon2id$new'),
  };
  const accessTokens = {
    sign: vi.fn().mockResolvedValue({ token: 'jwt', expiresIn: 900 }),
  };
  const sessions = { createFamily: vi.fn().mockResolvedValue(refreshSession) };
  const handler = new LoginHandler(
    { user: { findUnique }, passwordCredential: { update } } as never,
    hasher as never,
    accessTokens as never,
    sessions as never,
  );
  return { handler, findUnique, update, hasher, accessTokens, sessions };
}

describe('LoginHandler', () => {
  it('looks up the canonical email and returns tokens and the public profile', async () => {
    const { handler, findUnique, accessTokens, sessions } = setup();
    const result = await handler.execute(request);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ann@example.invalid' } }),
    );
    expect(sessions.createFamily).toHaveBeenCalledWith('user-1');
    expect(accessTokens.sign).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-1',
    });
    expect(result.refreshSession).toBe(refreshSession);
    expect(result.body).toEqual({
      accessToken: 'jwt',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 'user-1',
        email: 'ann@example.invalid',
        displayName: 'Ann',
        emailVerified: false,
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('raw-refresh');
  });

  it('spends dummy hashing time and fails identically for an unknown email', async () => {
    const { handler, hasher, sessions } = setup({ user: null });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(hasher.verifyDummy).toHaveBeenCalledWith(request.password);
    expect(hasher.verify).not.toHaveBeenCalled();
    expect(sessions.createFamily).not.toHaveBeenCalled();
  });

  it('treats an account without a password credential like an unknown email', async () => {
    const { handler, hasher } = setup({
      user: { ...user, passwordCredential: null },
    });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(hasher.verifyDummy).toHaveBeenCalled();
  });

  it('rejects a wrong password without creating a session', async () => {
    const { handler, sessions } = setup({ verify: false });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(sessions.createFamily).not.toHaveBeenCalled();
  });

  it('rejects a suspended account with the same error even for the right password', async () => {
    const { handler, sessions } = setup({
      user: { ...user, accountStatus: 'SUSPENDED' },
    });
    await expect(handler.execute(request)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(sessions.createFamily).not.toHaveBeenCalled();
  });

  it('upgrades an outdated hash after a successful login', async () => {
    const { handler, update } = setup({ needsRehash: true });
    await handler.execute(request);
    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: {
        passwordHash: '$argon2id$new',
        passwordUpdatedAt: expect.any(Date),
      },
    });
  });

  it('still logs in when the hash upgrade fails', async () => {
    const { handler } = setup({
      needsRehash: true,
      update: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(handler.execute(request)).resolves.toMatchObject({
      body: { accessToken: 'jwt' },
    });
  });

  it('does not rehash when parameters are current', async () => {
    const { handler, update } = setup({ needsRehash: false });
    await handler.execute(request);
    expect(update).not.toHaveBeenCalled();
  });
});
