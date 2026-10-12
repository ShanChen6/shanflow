'use client';

// Focus view: a master/detail layout ordered by what needs attention, not by status. Open tasks sorted by
// overdue → priority → deadline on the left, the selected task with one big action on the right. Best for "what next?".
import type { Task } from '@shanflow/contracts';
import { useState } from 'react';
import type { Board } from '../../application/use-board';
import { isOverdue } from '../../shared/board-model';
import { AssigneeSelect, button, DueLabel, PriorityBadge, STATUS_LABELS, StatusSelect, TaskEditor, assigneeName } from '../parts';

const PRIORITY_WEIGHT = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/** Most pressing first: overdue, then priority, then the nearest deadline, then the oldest. */
function byUrgency(now: Date) {
  return (a: Task, b: Task): number => {
    const [overdueA, overdueB] = [isOverdue(a, now), isOverdue(b, now)];
    if (overdueA !== overdueB) return overdueA ? -1 : 1;
    if (a.priority !== b.priority) return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    const [dueA, dueB] = [a.dueAt ? Date.parse(a.dueAt) : Infinity, b.dueAt ? Date.parse(b.dueAt) : Infinity];
    if (dueA !== dueB) return dueA - dueB;
    return a.createdAt < b.createdAt ? -1 : 1;
  };
}

export function FocusView({ board }: { board: Board }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const open = board.tasks.filter((task) => task.status === 'TODO' || task.status === 'IN_PROGRESS').sort(byUrgency(new Date()));
  const selected = board.tasks.find((task) => task.id === selectedId) ?? open[0];
  const closed = board.tasks.length - open.length;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section aria-label="Up next">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Up next ({open.length})</h2>
        <ol className="flex flex-col gap-1">
          {open.map((task, index) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(task.id);
                  setEditing(false);
                }}
                aria-current={selected?.id === task.id}
                className={`flex w-full items-start gap-3 rounded-md border p-2 text-left ${selected?.id === task.id ? 'border-brand-500 bg-slate-50' : 'border-slate-200'}`}
              >
                <span className="mt-0.5 w-5 text-sm text-slate-500">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{task.title}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    <DueLabel task={task} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {open.length === 0 ? <p className="text-slate-600">Nothing waiting. {closed > 0 ? `${closed} finished or cancelled.` : ''}</p> : null}
      </section>

      <section aria-label="Details" className="rounded-lg border border-slate-200 p-4">
        {selected ? (
          <div className="flex flex-col gap-3">
            <h2 className="break-words text-xl font-semibold">{selected.title}</h2>
            <p className="text-sm text-slate-600">
              {STATUS_LABELS[selected.status]}
              {assigneeName(board, selected) ? ` · ${assigneeName(board, selected)}` : ' · Unassigned'}
            </p>
            {selected.description ? <p className="whitespace-pre-wrap">{selected.description}</p> : null}
            <DueLabel task={selected} />
            {editing ? (
              <TaskEditor board={board} task={selected} onClose={() => setEditing(false)} />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-brand-500 px-4 py-2 font-medium text-brand-ink"
                    onClick={() => void board.move(selected, { status: 'DONE' })}
                  >
                    Mark as done
                  </button>
                  {selected.status === 'TODO' ? (
                    <button type="button" className={button} onClick={() => void board.move(selected, { status: 'IN_PROGRESS' })}>
                      Start
                    </button>
                  ) : null}
                  <button type="button" className={button} onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  <button type="button" className={button} onClick={() => void board.remove(selected)}>
                    Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusSelect board={board} task={selected} />
                  <AssigneeSelect board={board} task={selected} />
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-slate-600">Pick a task to see it here.</p>
        )}
      </section>
    </div>
  );
}
