import {
  POSITION_GAP,
  POSITION_MAX,
  appendPosition,
  positionBetween,
  positionToString,
} from './position.js';

describe('appendPosition', () => {
  it('starts an empty lane at one gap and then steps by a gap', () => {
    expect(appendPosition(null)).toBe(1024n);
    expect(appendPosition(1024n)).toBe(2048n);
    expect(appendPosition(0n)).toBe(1024n);
  });

  it('reports no room instead of overflowing int64', () => {
    expect(appendPosition(POSITION_MAX - POSITION_GAP)).toBe(POSITION_MAX);
    expect(appendPosition(POSITION_MAX - POSITION_GAP + 1n)).toBeNull();
    expect(appendPosition(POSITION_MAX)).toBeNull();
  });
});

describe('positionBetween', () => {
  it('uses the midpoint between neighbours and stays strictly between', () => {
    expect(positionBetween(1024n, 2048n)).toBe(1536n);
    expect(positionBetween(1n, 3n)).toBe(2n);
    expect(positionBetween(10n, 12n)).toBe(11n);
  });

  it('reports no room when neighbours are adjacent or out of order', () => {
    expect(positionBetween(5n, 6n)).toBeNull();
    expect(positionBetween(5n, 5n)).toBeNull();
    expect(positionBetween(9n, 3n)).toBeNull();
  });

  it('prepends with a gap when there is one, never going negative', () => {
    expect(positionBetween(null, 4096n)).toBe(3072n);
    expect(positionBetween(null, 1024n)).toBe(512n);
    expect(positionBetween(null, 1n)).toBe(0n);
    expect(positionBetween(null, 0n)).toBeNull();
  });

  it('appends after the last, and starts an empty lane', () => {
    expect(positionBetween(2048n, null)).toBe(3072n);
    expect(positionBetween(null, null)).toBe(1024n);
  });

  it('handles values near the int64 limit without overflow', () => {
    const mid = positionBetween(POSITION_MAX - 10n, POSITION_MAX);
    expect(mid).toBe(POSITION_MAX - 5n);
    expect(positionBetween(POSITION_MAX - 1n, POSITION_MAX)).toBeNull();
  });
});

describe('positionToString', () => {
  it('keeps full 64-bit precision', () => {
    expect(positionToString(POSITION_MAX)).toBe('9223372036854775807');
    expect(positionToString(0n)).toBe('0');
  });
});
