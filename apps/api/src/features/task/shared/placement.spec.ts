import { insertionIndex, neighbourRanks } from './placement.js';

const lane = [
  { id: 'a', position: 1024n },
  { id: 'b', position: 2048n },
  { id: 'c', position: 3072n },
];

describe('insertionIndex', () => {
  it('is the end of the lane when no neighbour is named', () => {
    expect(insertionIndex(lane, {})).toBe(3);
    expect(insertionIndex([], {})).toBe(0);
  });

  it('is just before or just after the named neighbour', () => {
    expect(insertionIndex(lane, { beforeId: 'a' })).toBe(0);
    expect(insertionIndex(lane, { beforeId: 'c' })).toBe(2);
    expect(insertionIndex(lane, { afterId: 'a' })).toBe(1);
    expect(insertionIndex(lane, { afterId: 'c' })).toBe(3);
  });

  it('is null when the neighbour is not in the lane', () => {
    expect(insertionIndex(lane, { beforeId: 'zzz' })).toBeNull();
    expect(insertionIndex(lane, { afterId: 'zzz' })).toBeNull();
    expect(insertionIndex([], { beforeId: 'a' })).toBeNull();
  });
});

describe('neighbourRanks', () => {
  it('reads the ranks on both sides of a slot, with open ends as null', () => {
    expect(neighbourRanks(lane, 0)).toEqual({ previous: null, next: 1024n });
    expect(neighbourRanks(lane, 1)).toEqual({ previous: 1024n, next: 2048n });
    expect(neighbourRanks(lane, 3)).toEqual({ previous: 3072n, next: null });
    expect(neighbourRanks([], 0)).toEqual({ previous: null, next: null });
  });
});
