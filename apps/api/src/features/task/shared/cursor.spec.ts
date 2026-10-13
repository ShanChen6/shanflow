import { InvalidCursorError, decodeCursor, encodeCursor } from './cursor.js';

const id = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';

describe('task cursor', () => {
  it('round-trips a position and id, including the int64 maximum', () => {
    for (const position of [0n, 1024n, 9223372036854775807n]) {
      expect(decodeCursor(encodeCursor({ position, id }))).toEqual({
        position,
        id,
      });
    }
  });

  it('is URL-safe', () => {
    expect(encodeCursor({ position: 9223372036854775807n, id })).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  it.each([
    ['empty', ''],
    ['not base64 text', '***'],
    ['no separator', Buffer.from('1024').toString('base64url')],
    ['negative position', Buffer.from(`-1.${id}`).toString('base64url')],
    [
      'bad id',
      Buffer.from('1024.not-a-uuid-not-a-uuid-not-a-uuid-12').toString(
        'base64url',
      ),
    ],
    [
      'position above int64',
      Buffer.from(`9223372036854775808.${id}`).toString('base64url'),
    ],
    ['leading zero', Buffer.from(`01.${id}`).toString('base64url')],
  ])('rejects a %s cursor', (_name, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });
});
