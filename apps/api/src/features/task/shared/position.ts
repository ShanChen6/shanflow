/** Task ranks (ADR-006/009): signed 64-bit integers kept in gaps so most inserts touch one row. */
export const POSITION_GAP = 1024n;
export const POSITION_MAX = (1n << 63n) - 1n;

/** The rank after the last live task of a lane, or the first rank for an empty lane. `null` = no room (rebalance). */
export function appendPosition(last: bigint | null): bigint | null {
  if (last === null) return POSITION_GAP;
  const next = last + POSITION_GAP;
  return next > POSITION_MAX ? null : next;
}

/**
 * A free rank strictly between two neighbours (either may be absent for the start/end of a lane), or `null`
 * when no integer is free and the lane must be rebalanced first. Never returns a negative rank.
 */
export function positionBetween(
  previous: bigint | null,
  next: bigint | null,
): bigint | null {
  if (next === null) return appendPosition(previous);
  if (previous === null) {
    if (next <= 0n) return null;
    return next > POSITION_GAP ? next - POSITION_GAP : next / 2n;
  }
  if (previous >= next) return null;
  const middle = previous + (next - previous) / 2n;
  return middle > previous ? middle : null;
}

/** The decimal string clients receive; JSON numbers and JSON.stringify(BigInt) are not safe for 64-bit values. */
export function positionToString(position: bigint): string {
  return position.toString(10);
}
