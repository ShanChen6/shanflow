import sharp from 'sharp';
import { InvalidImageError } from './user.errors.js';

export const AVATAR_SIZE = 256;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
// A 2 MiB file can still expand to a huge bitmap ("decompression bomb"); refuse anything beyond this many pixels.
const MAX_INPUT_PIXELS = 25_000_000;

/**
 * Turns an upload into the one image we store: decoded, EXIF-rotated, cropped to a 256×256 square and
 * re-encoded as WebP. Re-encoding drops all metadata (GPS, camera) and anything hidden in the original bytes,
 * so what we serve is always an image we produced, whatever the client sent.
 * The format is sniffed from the bytes: the declared Content-Type is not trusted.
 */
export async function processAvatar(bytes: Buffer): Promise<Buffer> {
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format))
      throw new InvalidImageError();
    return await image
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    // Corrupt, truncated, over-sized or unsupported input all look the same to the caller.
    throw error instanceof InvalidImageError ? error : new InvalidImageError();
  }
}
