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

export interface RebalancePlan {
  /** The new rank of every task of the lane, in lane order: 1024, 2048, … */
  finals: bigint[];
  /** Indexes (into the lane order) of the tasks whose rank really changes. */
  changed: number[];
  /** A temporary rank for each changed task, same order as `changed`. */
  temps: bigint[];
}

/**
 * Renumbers a lane to 1024·n while keeping its order. The lane's unique index is immediate, so rows cannot simply swap
 * ranks: every changed row is first parked on a temporary rank that nothing holds (and no final rank equals), then moved
 * to its final rank. The temporary ranks are the first run of free integers above the final ranks. `null` means no
 * such run fits below the int64 limit.
 *
 * `current` are the live ranks of the lane in lane order. A lane never holds more tasks than a workspace may
 * (`MAX_TASKS_PER_WORKSPACE`), so 1024·n always fits in int64.
 */
export function planRebalance(current: bigint[]): RebalancePlan | null {
  const finals = current.map((_, index) => BigInt(index + 1) * POSITION_GAP);
  const changed = current.flatMap((rank, index) =>
    rank === finals[index] ? [] : [index],
  );
  if (changed.length === 0) return { finals, changed, temps: [] };

  const count = BigInt(changed.length);
  let start = finals[finals.length - 1]! + 1n;
  for (const rank of [...current].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (rank < start) continue;
    if (rank >= start + count) break; // the run [start, start+count) is free
    start = rank + 1n;
  }
  if (start + count - 1n > POSITION_MAX) return null;
  return {
    finals,
    changed,
    temps: changed.map((_, offset) => start + BigInt(offset)),
  };
}
