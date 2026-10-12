import { Readable } from 'node:stream';
import type { Request } from 'express';
import { readBodyWithLimit } from './read-body.js';

function fakeRequest(chunks: Buffer[], headers: Record<string, string> = {}) {
  const stream = Readable.from(chunks) as unknown as Request;
  (stream as unknown as { headers: unknown }).headers = headers;
  return stream;
}

describe('readBodyWithLimit', () => {
  it('returns the whole body within the limit', async () => {
    const body = await readBodyWithLimit(
      fakeRequest([Buffer.from('ab'), Buffer.from('cd')]),
      4,
    );
    expect(body?.toString()).toBe('abcd');
  });

  it('rejects early on a too-large Content-Length', async () => {
    expect(
      await readBodyWithLimit(
        fakeRequest([Buffer.from('a')], { 'content-length': '10' }),
        4,
      ),
    ).toBeNull();
  });

  it('counts the real bytes when Content-Length lies or is absent', async () => {
    expect(
      await readBodyWithLimit(
        fakeRequest([Buffer.alloc(3), Buffer.alloc(3)], {
          'content-length': '1',
        }),
        4,
      ),
    ).toBeNull();
    expect(
      await readBodyWithLimit(fakeRequest([Buffer.alloc(5)]), 4),
    ).toBeNull();
  });
});
