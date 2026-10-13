import sharp from 'sharp';
import { AVATAR_SIZE, processAvatar } from './avatar-image.js';
import { InvalidImageError } from './user.errors.js';

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();

describe('processAvatar', () => {
  it('outputs a square WebP of the fixed size for any aspect ratio', async () => {
    for (const [w, h] of [
      [400, 100],
      [100, 400],
      [50, 50],
    ] as const) {
      const meta = await sharp(await processAvatar(await png(w, h))).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'webp',
        AVATAR_SIZE,
        AVATAR_SIZE,
      ]);
    }
  });

  it.each([
    ['text', Buffer.from('hello')],
    ['empty', Buffer.alloc(0)],
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary')],
  ])('rejects %s input', async (_name, bytes) => {
    await expect(processAvatar(bytes)).rejects.toBeInstanceOf(
      InvalidImageError,
    );
  });
});
