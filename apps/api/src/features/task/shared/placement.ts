export interface Ranked {
  id: string;
  position: bigint;
}

export interface Placement {
  beforeId?: string;
  afterId?: string;
}

/**
 * Where, among `others` (the live tasks of the destination lane in order, WITHOUT the task being moved), the moved task
 * goes: just before / after the named neighbour, or at the end when none is named. `null` when the neighbour is not in the lane.
 */
export function insertionIndex(
  others: Ranked[],
  placement: Placement,
): number | null {
  const neighbourId = placement.beforeId ?? placement.afterId;
  if (neighbourId === undefined) return others.length;
  const index = others.findIndex((task) => task.id === neighbourId);
  if (index === -1) return null;
  return placement.beforeId === undefined ? index + 1 : index;
}

/** The ranks of the tasks on both sides of a slot (`null` at an open end of the lane). */
export function neighbourRanks(
  others: Ranked[],
  index: number,
): { previous: bigint | null; next: bigint | null } {
  return {
    previous: others[index - 1]?.position ?? null,
    next: others[index]?.position ?? null,
  };
}
