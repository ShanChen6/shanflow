'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useBoard } from '../application/use-board';
import { httpTaskGateway } from '../infrastructure/http-task-gateway';
import { NewTaskForm, Notice, ScopeSelect, TrashPanel, button } from './parts';
import { PrototypeSwitcher } from './prototype-switcher';
import { FocusView } from './variants/focus-view';
import { GroupedList } from './variants/grouped-list';
import { KanbanBoard } from './variants/kanban-board';

const VARIANTS = [
  { id: 'A', label: 'Board' },
  { id: 'B', label: 'List' },
  { id: 'C', label: 'Focus' },
];

/** The tasks screen: loads through the HTTP gateway, then hands the same `board` to whichever layout is chosen. */
export function TasksPage() {
  const board = useBoard(httpTaskGateway);
  const requested = useSearchParams().get('variant') ?? 'A';
  const variant = VARIANTS.some((candidate) => candidate.id === requested) ? requested : 'A';
  const [showTrash, setShowTrash] = useState(false);

  if (board.phase === 'failed') {
    return (
      <p role="alert" className="text-red-700">
        Could not load your tasks. Please reload the page.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <div className="flex items-center gap-3">
          <ScopeSelect board={board} />
          <button
            type="button"
            className={button}
            onClick={() => {
              setShowTrash(!showTrash);
              if (!showTrash) void board.openTrash();
            }}
          >
            {showTrash ? 'Board' : 'Trash'}
          </button>
        </div>
      </header>
      <Notice board={board} />
      {showTrash ? (
        <TrashPanel board={board} />
      ) : (
        <>
          <NewTaskForm board={board} />
          {board.phase === 'loading' ? (
            <p role="status" className="text-slate-600">
              Loading…
            </p>
          ) : variant === 'B' ? (
            <GroupedList board={board} />
          ) : variant === 'C' ? (
            <FocusView board={board} />
          ) : (
            <KanbanBoard board={board} />
          )}
        </>
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </div>
  );
}
