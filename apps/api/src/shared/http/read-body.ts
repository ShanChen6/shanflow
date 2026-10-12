import type { Request } from 'express';

/**
 * Reads a raw request body with a hard size cap, counting bytes as they arrive. The Content-Length header is
 * only a fast pre-check: a client can lie about it or send chunked data, so the stream itself is limited.
 * Resolves to null if the cap is exceeded; the rest of the upload is discarded.
 */
export async function readBodyWithLimit(
  request: Request,
  limit: number,
): Promise<Buffer | null> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > limit) {
      request.resume();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
