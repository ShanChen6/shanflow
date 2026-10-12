'use client';

// VARIANT B — "List": one dense list grouped by status, a checkbox to complete, actions revealed on the row.
// Best for scanning many tasks quickly and for small screens. No drag and drop.
import { TASK_STATUSES, type Task } from '@shanflow/contracts';
import { useState } from 'react';
import type { Board } from '../../application/use-board';
import { stepPlacement } from '../../shared/board-model';
import { AssigneeSelect, button, DueLabel, PriorityBadge, STATUS_LABELS, StatusSelect, TaskEditor, assigneeName } from '../parts';

function Row({ board, task }: { board: Board; task: Task }) {
  const [open, setOpen] = useState(false);
  const column = board.columns[task.status];
  const done = task.status === 'DONE';
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          aria-label={`Complete ${task.title}`}
          checked={done}
          disabled={task.status === 'CANCELED'}
          onChange={() => void board.move(task, { status: done ? 'TODO' : 'DONE' })}
        />
        <div className="min-w-0 flex-1">
          <h3 className={`truncate ${done ? 'text-slate-500 line-through' : 'font-medium'}`}>{task.title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            <DueLabel task={task} />
            {assigneeName(board, task) ? <span className="text-xs text-slate-600">{assigneeName(board, task)}</span> : null}
          </div>
        </div>
        <button type="button" className={button} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Actions'}
        </button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-slate-50 p-2">
          <div className="flex flex-wrap gap-1">
            <StatusSelect board={board} task={task} />
            <AssigneeSelect board={board} task={task} />
            <button
              type="button"
              className={button}
              aria-label="Move up"
              disabled={!stepPlacement(column, task.id, 'up')}
              onClick={() => void board.move(task, stepPlacement(column, task.id, 'up')!)}
            >
              ↑
            </button>
            <button
              type="button"
              className={button}
              aria-label="Move down"
              disabled={!stepPlacement(column, task.id, 'down')}
              onClick={() => void board.move(task, stepPlacement(column, task.id, 'down')!)}
            >
              ↓
            </button>
            <button type="button" className={button} onClick={() => void board.remove(task)}>
              Delete
            </button>
          </div>
          <TaskEditor board={board} task={task} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </li>
  );
}

export function GroupedList({ board }: { board: Board }) {
  return (
    <div className="flex flex-col gap-4">
      {TASK_STATUSES.map((status) => (
        <details key={status} open={status !== 'CANCELED'} className="rounded-md border border-slate-200">
          <summary className="cursor-pointer bg-slate-50 px-3 py-2 text-sm font-semibold">
            {STATUS_LABELS[status]} <span className="font-normal text-slate-500">({board.columns[status].length})</span>
          </summary>
          <ul aria-label={STATUS_LABELS[status]} className="divide-y divide-slate-200">
            {board.columns[status].map((task) => (
              <Row key={task.id} board={board} task={task} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
