'use client';

// Board view: one column per status, cards you can drag (or step up/down with the buttons). Best for seeing flow.
import { TASK_STATUSES, type Task, type TaskStatus } from '@shanflow/contracts';
import { useState, type DragEvent } from 'react';
import type { Board } from '../../application/use-board';
import { dropPlacement, stepPlacement } from '../../shared/board-model';
import { AssigneeSelect, button, DueLabel, PriorityBadge, STATUS_LABELS, StatusSelect, TaskEditor, assigneeName } from '../parts';

const TASK_MIME = 'application/x-shanflow-task';

function Card({ board, task }: { board: Board; task: Task }) {
  const [editing, setEditing] = useState(false);
  const column = board.columns[task.status];
  const step = (direction: 'up' | 'down') => {
    const placement = stepPlacement(column, task.id, direction);
    if (placement) void board.move(task, placement);
  };
  return (
    <li
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData(TASK_MIME, task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className="cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm"
    >
      <h3 className="break-words font-medium">{task.title}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={task.priority} />
        <DueLabel task={task} />
        {assigneeName(board, task) ? <span className="text-xs text-slate-600">{assigneeName(board, task)}</span> : null}
      </div>
      {editing ? (
        <div className="mt-2">
          <TaskEditor board={board} task={task} onClose={() => setEditing(false)} />
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          <StatusSelect board={board} task={task} />
          <AssigneeSelect board={board} task={task} />
          <button type="button" className={button} aria-label="Move up" disabled={!stepPlacement(column, task.id, 'up')} onClick={() => step('up')}>
            ↑
          </button>
          <button type="button" className={button} aria-label="Move down" disabled={!stepPlacement(column, task.id, 'down')} onClick={() => step('down')}>
            ↓
          </button>
          <button type="button" className={button} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className={button} onClick={() => void board.remove(task)}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function Column({ board, status }: { board: Board; status: TaskStatus }) {
  const tasks = board.columns[status];
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const dragged = board.tasks.find((task) => task.id === event.dataTransfer.getData(TASK_MIME));
    if (!dragged) return; // something that is not a card of this board
    // The slot is the number of other cards whose middle is above the pointer.
    const cards = Array.from(event.currentTarget.querySelectorAll('li[draggable]'));
    const others = tasks.filter((task) => task.id !== dragged.id);
    const slot = cards.filter(
      (card, index) => tasks[index]?.id !== dragged.id && card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2 < event.clientY,
    ).length;
    void board.move(dragged, { status, ...dropPlacement(others, dragged.id, slot) });
  }
  return (
    <section aria-label={STATUS_LABELS[status]} className="min-w-0 rounded-lg bg-slate-100 p-2" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <h2 className="mb-2 px-1 text-sm font-semibold text-slate-700">
        {STATUS_LABELS[status]} <span className="font-normal text-slate-500">({tasks.length})</span>
      </h2>
      <ul className="flex min-h-12 flex-col gap-2">
        {tasks.map((task) => (
          <Card key={task.id} board={board} task={task} />
        ))}
      </ul>
    </section>
  );
}

export function BoardView({ board }: { board: Board }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status) => (
        <Column key={status} board={board} status={status} />
      ))}
    </div>
  );
}
