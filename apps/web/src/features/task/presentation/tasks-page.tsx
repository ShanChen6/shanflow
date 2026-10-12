'use client';

import { useState } from 'react';
import { useBoard } from '../application/use-board';
import { httpTaskGateway } from '../infrastructure/http-task-gateway';
import { NewTaskForm, Notice, ScopeSelect, TrashPanel, button } from './parts';
import { VIEWS, VIEW_LABELS, useViewMode, type View } from './view-mode';
import { BoardView } from './views/board-view';
import { FocusView } from './views/focus-view';
import { ListView } from './views/list-view';

function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
      {VIEWS.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={candidate === view}
          onClick={() => onChange(candidate)}
          className={`px-3 py-1 ${candidate === view ? 'bg-brand-500 font-medium text-brand-ink' : 'hover:bg-slate-100'}`}
        >
          {VIEW_LABELS[candidate]}
        </button>
      ))}
    </div>
  );
}

/** The tasks screen: loads through the HTTP gateway, then shows the same `board` in the layout the user picked. */
export function TasksPage() {
  const board = useBoard(httpTaskGateway);
  const [view, setView] = useViewMode();
  const [showTrash, setShowTrash] = useState(false);

  if (board.phase === 'failed') {
    return (
      <p role="alert" className="text-red-700">
        Could not load your tasks. Please reload the page.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <div className="flex flex-wrap items-center gap-3">
          <ScopeSelect board={board} />
          {showTrash ? null : <ViewSwitch view={view} onChange={setView} />}
          <button
            type="button"
            className={button}
            onClick={() => {
              setShowTrash(!showTrash);
              if (!showTrash) void board.openTrash();
            }}
          >
            {showTrash ? 'Back to tasks' : 'Trash'}
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
          ) : view === 'list' ? (
            <ListView board={board} />
          ) : view === 'focus' ? (
            <FocusView board={board} />
          ) : (
            <BoardView board={board} />
          )}
        </>
      )}
    </div>
  );
}
