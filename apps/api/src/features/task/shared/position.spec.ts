import {
  POSITION_GAP,
  POSITION_MAX,
  appendPosition,
  planRebalance,
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

describe('planRebalance', () => {
  const finalsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => BigInt(i + 1) * POSITION_GAP);

  /** Every rank written during a plan, in order: stage then final. All of them must be distinct from what is still in place. */
  function check(current: bigint[]) {
    const plan = planRebalance(current);
    expect(plan).not.toBeNull();
    const { finals, changed, temps } = plan!;
    expect(finals).toEqual(finalsOf(current.length));
    expect(temps).toHaveLength(changed.length);

    // Phase 1: the changed rows move to their temporary ranks. No temporary rank may equal any rank held by any row, or each other.
    const held = new Set(current.map(String));
    const stageSet = new Set(temps.map(String));
    expect(stageSet.size).toBe(temps.length);
    for (const t of temps) {
      expect(held.has(String(t))).toBe(false);
      expect(t >= 0n && t <= POSITION_MAX).toBe(true);
    }
    // Phase 2: every final rank must be free once phase 1 is done (unchanged rows already hold theirs).
    const afterStage = current.map((c, i) =>
      changed.includes(i) ? temps[changed.indexOf(i)]! : c,
    );
    for (const i of changed)
      expect(afterStage.some((p) => p === finals[i])).toBe(false);
    return plan!;
  }

  it('numbers a lane 1024, 2048, ... keeping the order', () => {
    const plan = check([5n, 6n, 7n]);
    expect(plan.finals).toEqual([1024n, 2048n, 3072n]);
    expect(plan.changed).toEqual([0, 1, 2]);
  });

  it('leaves rows that already hold their final rank alone', () => {
    const plan = check([1024n, 2048n, 2049n, 9000n]);
    expect(plan.changed).toEqual([2, 3]);
  });

  it('plans nothing for a lane that is already evenly numbered, or empty', () => {
    expect(planRebalance(finalsOf(4))).toEqual({
      finals: finalsOf(4),
      changed: [],
      temps: [],
    });
    expect(planRebalance([])).toEqual({ finals: [], changed: [], temps: [] });
  });

  it('stages above everything when there is room, so no write ever collides', () => {
    const plan = check([10n, 11n, 12n]);
    expect(plan.temps.every((t) => t > 12n && t > 3072n)).toBe(true);
  });

  it('stages in the free band under the existing ranks when the top of the range is taken', () => {
    const plan = check([POSITION_MAX - 1n, POSITION_MAX]);
    expect(plan.temps.every((t) => t > 2048n && t < POSITION_MAX - 1n)).toBe(
      true,
    );
  });

  it('still works when current ranks sit exactly at both ends of the range', () => {
    check([0n, POSITION_MAX]);
    check([0n, 1n, POSITION_MAX - 1n, POSITION_MAX]);
  });
});
