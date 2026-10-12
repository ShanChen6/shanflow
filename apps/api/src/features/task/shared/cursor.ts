import { DomainError } from '../../../shared/errors/domain-error.js';

/** Raised for a cursor that is malformed or was not produced by this API. */
export class InvalidCursorError extends DomainError {
  constructor() {
    super('VALIDATION_FAILED', 400, 'The request is not valid.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TaskCursor {
  position: bigint;
  id: string;
}

/** An opaque keyset cursor over (position, id): stable when tasks are added or removed between pages. */
export function encodeCursor({ position, id }: TaskCursor): string {
  return Buffer.from(`${position.toString(10)}.${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): TaskCursor {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^(0|[1-9]\d{0,18})\.([0-9a-f-]{36})$/.exec(decoded);
  if (!match || !UUID.test(match[2]!)) throw new InvalidCursorError();
  const position = BigInt(match[1]!);
  if (position > (1n << 63n) - 1n) throw new InvalidCursorError();
  return { position, id: match[2]! };
}
