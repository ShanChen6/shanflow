'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Workspace, WorkspaceMember } from '@shanflow/contracts';
import { FormAlert, SubmitButton } from '@/shared/ui/form-controls';
import { canRename, loadWorkspace, renameWorkspace, validateWorkspaceName } from './workspace.action';

const ROLE_LABELS = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' } as const;

function RenameForm({ workspace, onRenamed }: { workspace: Workspace; onRenamed: (workspace: Workspace) => void }) {
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '');
    setSaved(false);
    setFormError(undefined);
    const clientError = validateWorkspaceName(name);
    setNameError(clientError);
    if (clientError) return;
    setPending(true);
    try {
      const outcome = await renameWorkspace(workspace, name);
      if (outcome.status === 'renamed') {
        onRenamed(outcome.workspace);
        setSaved(true);
      } else if (outcome.status === 'error') {
        setNameError(outcome.nameError);
        setFormError(outcome.formError);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <h2 className="text-lg font-semibold">Workspace name</h2>
      {saved ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Name updated.
        </p>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <div>
        <label htmlFor="workspaceName" className="mb-1 block text-sm font-medium">
          Name
        </label>
        {/* Keyed by the saved value so the field shows the normalised name the server stored. */}
        <input
          key={workspace.name}
          id="workspaceName"
          name="name"
          type="text"
          defaultValue={workspace.name}
          disabled={pending}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'workspaceName-error' : undefined}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-900 focus:outline-none aria-[invalid=true]:border-red-600"
        />
        {nameError ? (
          <p id="workspaceName-error" className="mt-1 text-sm text-red-700">
            {nameError}
          </p>
        ) : null}
      </div>
      <SubmitButton pending={pending} idle="Save name" busy="Saving…" />
    </form>
  );
}

function Members({ members }: { members: WorkspaceMember[] }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Members</h2>
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center justify-between px-3 py-2">
            <span>{member.displayName}</span>
            <span className="text-sm text-slate-600">{ROLE_LABELS[member.role]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WorkspaceView() {
  const [state, setState] = useState<{ workspace: Workspace; members: WorkspaceMember[] } | 'loading' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    void loadWorkspace().then((result) => {
      // A signed-out result clears the session, so RequireAuth takes over; nothing to show here.
      if (active) setState(result.status === 'ready' ? { workspace: result.workspace, members: result.members } : 'error');
    });
    return () => {
      active = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <p role="status" className="text-slate-600">
        Loading…
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p role="alert" className="text-red-700">
        Could not load your workspace. Please reload the page.
      </p>
    );
  }

  const { workspace, members } = state;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-2xl font-bold">{workspace.name}</h1>
        <p className="text-sm text-slate-600">
          {workspace.type === 'PERSONAL' ? 'Personal workspace' : 'Team workspace'} · Your role: {ROLE_LABELS[workspace.role]}
        </p>
      </section>
      {canRename(workspace) ? <RenameForm workspace={workspace} onRenamed={(renamed) => setState({ workspace: renamed, members })} /> : null}
      <Members members={members} />
    </div>
  );
}
