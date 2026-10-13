'use client';

// Shared building blocks of the task screens. The variants differ in LAYOUT; every rule (who may assign, which statuses
// exist, how a deadline is shown) comes from the domain layer and the contracts, so it is the same in all of them.
import { TASK_PRIORITIES, TASK_STATUSES, type Task, type TaskStatus } from '@shanflow/contracts';
import { useState, type FormEvent } from 'react';
import type { Board } from '../application/use-board';
import { assigneeChoices, fromDateTimeLocalValue, isOverdue, toDateTimeLocalValue } from '../shared/board-model';

export const STATUS_LABELS: Record<TaskStatus, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done', CANCELED: 'Cancelled' };
const PRIORITY_LABELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' } as const;
const PRIORITY_STYLES = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-blue-100 text-blue-800',
  HIGH: 'bg-amber-100 text-amber-900',
  URGENT: 'bg-red-100 text-red-800',
} as const;

const select = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm';
export const button = 'rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-40';

export function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority]}`}>{PRIORITY_LABELS[priority]} priority</span>;
}

export function DueLabel({ task }: { task: Task }) {
  if (!task.dueAt) return null;
  const overdue = isOverdue(task, new Date());
  const text = new Date(task.dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return <span className={`text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{overdue ? `Overdue · ${text}` : `Due ${text}`}</span>;
}

export function assigneeName(board: Board, task: Task): string | undefined {
  return board.context?.members.find((member) => member.userId === task.assigneeId)?.displayName;
}

export function StatusSelect({ board, task }: { board: Board; task: Task }) {
  return (
    <select
      aria-label={`Status of ${task.title}`}
      className={select}
      value={task.status}
      onChange={(event) => void board.move(task, { status: event.target.value as TaskStatus })}
    >
      {TASK_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_LABELS[status]}
        </option>
      ))}
    </select>
  );
}

export function AssigneeSelect({ board, task }: { board: Board; task: Task }) {
  if (!board.actor || !board.context) return null;
  return (
    <select
      aria-label={`Assignee of ${task.title}`}
      className={select}
      value={task.assigneeId ?? ''}
      onChange={(event) => void board.assign(task, event.target.value || null)}
    >
      {assigneeChoices(board.actor, task, board.context.members).map((choice) => (
        <option key={choice.value} value={choice.value} disabled={choice.disabled && choice.value !== (task.assigneeId ?? '')}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

export function ScopeSelect({ board }: { board: Board }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      Project
      <select className={select} value={board.scope} onChange={(event) => board.selectScope(event.target.value)}>
        <option value="inbox">Inbox</option>
        {board.context?.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NewTaskForm({ board }: { board: Board }) {
  const [title, setTitle] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((await board.create(title)) === 'done') setTitle('');
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        aria-label="New task title"
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5"
        placeholder="Add a task…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button type="submit" className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-brand-ink">
        Add task
      </button>
    </form>
  );
}

export function Notice({ board }: { board: Board }) {
  if (!board.notice) return null;
  return (
    <p role="alert" className="flex justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {board.notice}
      <button type="button" className="underline" onClick={board.dismissNotice}>
        Dismiss
      </button>
    </p>
  );
}

/** Title, description, priority and deadline. Saves only what changed; stays open when the server refuses. */
export function TaskEditor({ board, task, onClose }: { board: Board; task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [due, setDue] = useState(toDateTimeLocalValue(task.dueAt));
  async function save(event: FormEvent) {
    event.preventDefault();
    const outcome = await board.edit(task, { title, description, priority, dueAt: fromDateTimeLocalValue(due) });
    if (outcome === 'done') onClose();
  }
  const field = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm';
  return (
    <form onSubmit={save} className="flex flex-col gap-2 text-sm">
      <label>
        Title
        <input className={field} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Description
        <textarea className={field} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          Priority
          <select className={field} value={priority} onChange={(event) => setPriority(event.target.value as Task['priority'])}>
            {TASK_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Deadline
          <input type="datetime-local" className={field} value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-brand-500 px-3 py-1 text-brand-ink">
          Save
        </button>
        <button type="button" className={button} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TrashPanel({ board }: { board: Board }) {
  if (!board.trash) return <p role="status">Loading…</p>;
  if (board.trash.length === 0) return <p className="text-slate-600">The trash is empty.</p>;
  return (
    <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
      {board.trash.map((task) => (
        <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <span>
            {task.title} <span className="text-xs text-slate-500">· {STATUS_LABELS[task.status]}</span>
          </span>
          <button type="button" className={button} onClick={() => void board.restore(task)}>
            Restore
          </button>
        </li>
      ))}
    </ul>
  );
}
