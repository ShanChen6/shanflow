'use client';

import { taskTitleSchema, type MoveTaskRequest, type Task, type TaskActor } from '@shanflow/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/features/auth/shared/session-store';
import { groupByStatus, type Columns } from '../shared/board-model';
import type { BoardContext, Scope, TaskResult } from '../shared/task-client';
import type { TaskGateway } from './task-gateway';

export type Phase = 'loading' | 'ready' | 'failed';

/** What a user can change about a task in the editor. */
export interface TaskEdit {
  title?: string;
  description?: string | null;
  priority?: Task['priority'];
  dueAt?: string | null;
}

/** The result of a command, so the screen can keep an editor open when it was refused. */
export type Outcome = 'done' | 'refused';

export interface Board {
  phase: Phase;
  context: BoardContext | undefined;
  actor: TaskActor | undefined;
  scope: Scope;
  tasks: Task[];
  columns: Columns;
  trash: Task[] | undefined;
  /** The latest message for the user: a refusal, a conflict, or a validation problem. */
  notice: string | undefined;
  dismissNotice(): void;
  selectScope(scope: Scope): void;
  reload(): Promise<void>;
  create(title: string): Promise<Outcome>;
  edit(task: Task, edit: TaskEdit): Promise<Outcome>;
  /** Reorder, change project and/or status in one step (a drag, a "move to" menu, a step up or down). */
  move(task: Task, request: Omit<MoveTaskRequest, 'version'>): Promise<Outcome>;
  assign(task: Task, assigneeId: string | null): Promise<Outcome>;
  remove(task: Task): Promise<Outcome>;
  openTrash(): Promise<void>;
  restore(task: Task): Promise<Outcome>;
}

const replaceTask = (tasks: Task[], next: Task) => tasks.map((task) => (task.id === next.id ? next : task));

/**
 * The board's use cases. All I/O goes through the gateway; this holds the state and the rules for reacting to answers:
 * successes replace the task with what the server returned (version, rank, completion), refusals become a notice, and
 * a conflict reloads the board so the screen never keeps showing something the server disagrees with.
 */
export function useBoard(gateway: TaskGateway): Board {
  const session = useSession();
  const [context, setContext] = useState<BoardContext>();
  const [scope, setScope] = useState<Scope>('inbox');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trash, setTrash] = useState<Task[]>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [notice, setNotice] = useState<string>();
  const workspaceId = context?.workspace.id;
  // The scope the screen currently shows, readable from async callbacks without re-creating them.
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const loadTasks = useCallback(
    async (id: string, forScope: Scope) => {
      const result = await gateway.listTasks(id, forScope);
      // A newer scope may have been chosen while this answer was on its way: ignore stale answers.
      if (forScope !== scopeRef.current) return;
      if (result.status === 'ok') {
        setTasks(result.data);
        setPhase('ready');
      } else if (result.status === 'error') setPhase('failed');
    },
    [gateway],
  );

  useEffect(() => {
    let active = true;
    void gateway.loadContext().then((result) => {
      if (!active) return;
      if (result.status === 'ok') setContext(result.data);
      else if (result.status === 'error') setPhase('failed');
    });
    return () => {
      active = false;
    };
  }, [gateway]);

  useEffect(() => {
    // The state is set after the request answers, not synchronously: this effect only starts the load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (workspaceId) void loadTasks(workspaceId, scope);
  }, [workspaceId, scope, loadTasks]);

  /** Applies a gateway answer: runs `onOk` on success, otherwise shows the message (and reloads when the data is stale). */
  const settle = useCallback(
    async <T>(result: TaskResult<T>, onOk: (data: T) => void): Promise<Outcome> => {
      if (result.status === 'ok') {
        setNotice(undefined);
        onOk(result.data);
        return 'done';
      }
      if (result.status === 'error') {
        setNotice(result.message);
        if (result.reload && workspaceId) await loadTasks(workspaceId, scopeRef.current);
      }
      return 'refused';
    },
    [workspaceId, loadTasks],
  );

  const refused = useCallback((message: string): Outcome => {
    setNotice(message);
    return 'refused';
  }, []);

  const create = useCallback(
    async (title: string) => {
      const parsed = taskTitleSchema.safeParse(title);
      if (!workspaceId) return 'refused';
      if (!parsed.success) return refused('Enter a title of 1 to 200 characters, without line breaks or hidden characters.');
      const projectId = scopeRef.current === 'inbox' ? null : scopeRef.current;
      return settle(await gateway.create(workspaceId, { title: parsed.data, projectId }), (task) => setTasks((all) => [...all, task]));
    },
    [workspaceId, gateway, settle, refused],
  );

  const edit = useCallback(
    async (task: Task, change: TaskEdit) => {
      if (!workspaceId) return 'refused';
      const changes: TaskEdit = {};
      if (change.title !== undefined && change.title.trim() !== task.title) changes.title = change.title;
      if (change.description !== undefined && (change.description?.trim() || null) !== task.description) changes.description = change.description;
      if (change.priority !== undefined && change.priority !== task.priority) changes.priority = change.priority;
      if (change.dueAt !== undefined && change.dueAt !== task.dueAt) changes.dueAt = change.dueAt;
      if (Object.keys(changes).length === 0) return 'done'; // nothing to save
      if (changes.title !== undefined && !taskTitleSchema.safeParse(changes.title).success)
        return refused('Enter a title of 1 to 200 characters, without line breaks or hidden characters.');
      return settle(await gateway.update(workspaceId, task.id, { version: task.version, ...changes }), (next) => setTasks((all) => replaceTask(all, next)));
    },
    [workspaceId, gateway, settle, refused],
  );

  const move = useCallback(
    async (task: Task, request: Omit<MoveTaskRequest, 'version'>) => {
      if (!workspaceId) return 'refused';
      return settle(await gateway.move(workspaceId, task.id, { version: task.version, ...request }), ({ task: next, laneRebalanced }) => {
        // Other cards of a renumbered lane changed rank too, and a card that left this scope must disappear: reload.
        if (laneRebalanced || next.projectId !== task.projectId) void loadTasks(workspaceId, scopeRef.current);
        else setTasks((all) => replaceTask(all, next));
      });
    },
    [workspaceId, gateway, settle, loadTasks],
  );

  const assign = useCallback(
    async (task: Task, assigneeId: string | null) => {
      if (!workspaceId) return 'refused';
      return settle(await gateway.assign(workspaceId, task.id, { assigneeId, version: task.version }), (next) => setTasks((all) => replaceTask(all, next)));
    },
    [workspaceId, gateway, settle],
  );

  const remove = useCallback(
    async (task: Task) => {
      if (!workspaceId) return 'refused';
      return settle(await gateway.remove(workspaceId, task.id, task.version), (deleted) => {
        setTasks((all) => all.filter((candidate) => candidate.id !== task.id));
        setTrash((current) => (current ? [deleted, ...current] : current));
      });
    },
    [workspaceId, gateway, settle],
  );

  const openTrash = useCallback(async () => {
    if (!workspaceId) return;
    await settle(await gateway.listTrash(workspaceId), setTrash);
  }, [workspaceId, gateway, settle]);

  const restore = useCallback(
    async (task: Task) => {
      if (!workspaceId) return 'refused';
      return settle(await gateway.restore(workspaceId, task.id, task.version), (back) => {
        setTrash((current) => current?.filter((candidate) => candidate.id !== back.id));
        if ((back.projectId ?? 'inbox') === scopeRef.current) setTasks((all) => [...all, back]);
      });
    },
    [workspaceId, gateway, settle],
  );

  const reload = useCallback(async () => {
    if (workspaceId) await loadTasks(workspaceId, scopeRef.current);
  }, [workspaceId, loadTasks]);

  const actor = useMemo<TaskActor | undefined>(
    () => (context && session ? { role: context.workspace.role, userId: session.user.id } : undefined),
    [context, session],
  );
  const columns = useMemo(() => groupByStatus(tasks), [tasks]);

  return {
    phase,
    context,
    actor,
    scope,
    tasks,
    columns,
    trash,
    notice,
    dismissNotice: () => setNotice(undefined),
    selectScope: (next) => {
      setNotice(undefined);
      setTasks([]);
      setPhase('loading');
      setScope(next);
    },
    reload,
    create,
    edit,
    move,
    assign,
    remove,
    openTrash,
    restore,
  };
}
