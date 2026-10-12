import { EmailAlreadyRegisteredError } from '../shared/auth.errors.js';
import { RegisterHandler } from './register.handler.js';

const request = {
  email: '  Ann@Example.INVALID ',
  password: 'correct horse battery',
  displayName: 'Ann',
};

function setup(create: ReturnType<typeof vi.fn>) {
  const hash = vi.fn().mockResolvedValue('$argon2id$hashed');
  const handler = new RegisterHandler(
    { user: { create } } as never,
    { hash } as never,
  );
  return { handler, hash };
}

describe('RegisterHandler', () => {
  it('stores the canonical email and password hash, and never the plaintext', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'id-1',
      email: 'ann@example.invalid',
      displayName: 'Ann',
      emailVerifiedAt: null,
    });
    const { handler, hash } = setup(create);
    const result = await handler.execute(request);
    expect(hash).toHaveBeenCalledWith('correct horse battery');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email: 'ann@example.invalid',
          displayName: 'Ann',
          passwordCredential: { create: { passwordHash: '$argon2id$hashed' } },
        },
      }),
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('correct horse');
    expect(result).toEqual({
      user: {
        id: 'id-1',
        email: 'ann@example.invalid',
        displayName: 'Ann',
        emailVerified: false,
      },
    });
  });

  it('reports emailVerified true when a verification timestamp exists', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'id-1',
      email: 'a@b.io',
      displayName: 'A',
      emailVerifiedAt: new Date(),
    });
    expect(
      (await setup(create).handler.execute(request)).user.emailVerified,
    ).toBe(true);
  });

  it('maps a unique violation to EmailAlreadyRegisteredError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(setup(create).handler.execute(request)).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it('rethrows unexpected database errors unchanged', async () => {
    const failure = Object.assign(new Error('connection lost'), {
      code: 'P1001',
    });
    await expect(
      setup(vi.fn().mockRejectedValue(failure)).handler.execute(request),
    ).rejects.toBe(failure);
  });

  it('does not touch the database when hashing fails', async () => {
    const create = vi.fn();
    const hash = vi.fn().mockRejectedValue(new RangeError('bad length'));
    const handler = new RegisterHandler(
      { user: { create } } as never,
      { hash } as never,
    );
    await expect(handler.execute(request)).rejects.toThrow(RangeError);
    expect(create).not.toHaveBeenCalled();
  });
});
