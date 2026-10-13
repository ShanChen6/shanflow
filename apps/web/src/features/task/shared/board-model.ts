import { canChangeAssignee, TASK_STATUSES, type Task, type TaskActor, type TaskStatus, type WorkspaceMember } from '@shanflow/contracts';

export type Columns = Record<TaskStatus, Task[]>;

/** Ranks are 64-bit integers carried as strings: compare them as numbers (BigInt), never as text or JS numbers. */
const byRank = (a: Task, b: Task): number => {
  const [x, y] = [BigInt(a.position), BigInt(b.position)];
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** The board: one column per status, each in display order. */
export function groupByStatus(tasks: Task[]): Columns {
  const columns = Object.fromEntries(TASK_STATUSES.map((status) => [status, [] as Task[]])) as Columns;
  for (const task of [...tasks].sort(byRank)) columns[task.status].push(task);
  return columns;
}

/** What the server needs to place a card: the neighbour it should sit in front of (or after), never a rank. */
export interface Placement {
  beforeId?: string;
  afterId?: string;
}

/**
 * The placement for dropping a card into a column at `slot` (0 = top). `slot` counts positions among the column's OTHER
 * cards, so dragging inside a column behaves the same as dragging in from outside. A slot past the end means the end.
 */
export function dropPlacement(column: Task[], draggedId: string, slot: number): Placement {
  const others = column.filter((task) => task.id !== draggedId);
  const target = others[Math.max(0, slot)];
  return target ? { beforeId: target.id } : {};
}

/** One step up or down inside a column, as a placement; `null` at an end of the column (or for a card not in it). */
export function stepPlacement(column: Task[], taskId: string, direction: 'up' | 'down'): Placement | null {
  const index = column.findIndex((task) => task.id === taskId);
  if (index === -1) return null;
  if (direction === 'up') return index === 0 ? null : { beforeId: column[index - 1]!.id };
  return index === column.length - 1 ? null : { afterId: column[index + 1]!.id };
}

/** Overdue means open (not done, not cancelled) and past its deadline. */
export function isOverdue(task: Pick<Task, 'status' | 'dueAt'>, now: Date): boolean {
  if (task.dueAt === null || task.status === 'DONE' || task.status === 'CANCELED') return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A stored instant as the value of a `datetime-local` input, in the browser's own time zone. */
export function toDateTimeLocalValue(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The inverse: what the user typed, as a UTC instant for the API. Empty or unreadable input is "no deadline". */
export function fromDateTimeLocalValue(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface AssigneeChoice {
  /** The user id, or '' for nobody. */
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * The assignee menu for one task and one actor. Which entries are allowed is the permission matrix itself
 * (`canChangeAssignee`, shared with the server), so the screen can only hide what the server would refuse.
 */
export function assigneeChoices(actor: TaskActor, task: Pick<Task, 'assigneeId'>, members: WorkspaceMember[]): AssigneeChoice[] {
  const entries = [{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.userId, label: m.displayName }))];
  return entries.map((entry) => ({ ...entry, disabled: !canChangeAssignee(actor, task.assigneeId, entry.value === '' ? null : entry.value) }));
}
