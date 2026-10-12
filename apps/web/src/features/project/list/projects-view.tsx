'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PROJECT_COLORS, PROJECT_ICONS, type Project, type Workspace } from '@shanflow/contracts';
import { FormAlert, SubmitButton } from '@/shared/ui/form-controls';
import { canManage, createProject, loadProjects, setArchived, updateProject, type ProjectOutcome, type StatusFilter } from './project.action';

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-900 focus:outline-none';
const inputClass = `${selectClass} aria-[invalid=true]:border-red-600`;
const COLOR_STYLES: Record<string, string> = {
  slate: 'bg-slate-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
};

interface DetailsFormProps {
  initial?: Project;
  submitLabel: string;
  onSubmit: (values: { name: string; description: string; color: string | null; icon: string | null }) => Promise<ProjectOutcome>;
  onDone: (project: Project) => void;
  onCancel?: () => void;
}

/** Name, description, colour and icon: used both to create a project and to edit one. */
function DetailsForm({ initial, submitLabel, onSubmit, onDone, onCancel }: DetailsFormProps) {
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setNameError(undefined);
    setFormError(undefined);
    setPending(true);
    try {
      const outcome = await onSubmit({
        name: String(data.get('name') ?? ''),
        description: String(data.get('description') ?? ''),
        color: String(data.get('color') ?? '') || null,
        icon: String(data.get('icon') ?? '') || null,
      });
      if (outcome.status === 'ok') {
        if (!initial) form.reset();
        onDone(outcome.project);
      } else if (outcome.status === 'error') {
        setNameError(outcome.nameError);
        setFormError(outcome.formError);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handle} noValidate className="flex flex-col gap-3">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <div>
        <label htmlFor={`name-${initial?.id ?? 'new'}`} className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input
          id={`name-${initial?.id ?? 'new'}`}
          name="name"
          defaultValue={initial?.name}
          disabled={pending}
          aria-invalid={nameError ? true : undefined}
          className={inputClass}
        />
        {nameError ? <p className="mt-1 text-sm text-red-700">{nameError}</p> : null}
      </div>
      <div>
        <label htmlFor={`description-${initial?.id ?? 'new'}`} className="mb-1 block text-sm font-medium">
          Description (optional)
        </label>
        <textarea
          id={`description-${initial?.id ?? 'new'}`}
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ''}
          disabled={pending}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`color-${initial?.id ?? 'new'}`} className="mb-1 block text-sm font-medium">
            Colour
          </label>
          <select id={`color-${initial?.id ?? 'new'}`} name="color" defaultValue={initial?.color ?? ''} disabled={pending} className={selectClass}>
            <option value="">None</option>
            {PROJECT_COLORS.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`icon-${initial?.id ?? 'new'}`} className="mb-1 block text-sm font-medium">
            Icon
          </label>
          <select id={`icon-${initial?.id ?? 'new'}`} name="icon" defaultValue={initial?.icon ?? ''} disabled={pending} className={selectClass}>
            <option value="">None</option>
            {PROJECT_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton pending={pending} idle={submitLabel} busy="Saving…" />
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-sm underline">
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ProjectRow({ project, manage, onChanged }: { project: Project; manage: boolean; onChanged: (project: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const archived = project.archivedAt !== null;

  async function toggleArchive() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const outcome = await setArchived(project, !archived);
      if (outcome.status === 'ok') onChanged(outcome.project);
      else if (outcome.status === 'error') setError(outcome.formError);
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {project.color ? <span aria-hidden className={`inline-block h-3 w-3 rounded-full ${COLOR_STYLES[project.color] ?? ''}`} /> : null}
            <span className="break-words">{project.name}</span>
            {project.icon ? <span className="text-xs text-slate-500">({project.icon})</span> : null}
          </p>
          {project.description ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{project.description}</p> : null}
        </div>
        {manage ? (
          <div className="flex shrink-0 gap-3 text-sm">
            {archived ? null : (
              <button type="button" onClick={() => setEditing(!editing)} className="underline">
                Edit
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => void toggleArchive()} className="underline disabled:opacity-60">
              {archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {editing ? (
        <DetailsForm
          initial={project}
          submitLabel="Save"
          onSubmit={(values) =>
            updateProject(project, {
              name: values.name,
              description: values.description,
              color: values.color as Project['color'],
              icon: values.icon as Project['icon'],
            })
          }
          onDone={(updated) => {
            setEditing(false);
            onChanged(updated);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

export function ProjectsView() {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [workspace, setWorkspace] = useState<Workspace>();
  const [projects, setProjects] = useState<Project[]>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next: StatusFilter, known?: Workspace) => {
    setProjects(undefined);
    const result = await loadProjects(next, known);
    if (result.status === 'ready') {
      setWorkspace(result.workspace);
      setProjects(result.projects);
    } else setFailed(true);
  }, []);

  useEffect(() => {
    // Loading starts here and finishes asynchronously; a signed-out result clears the session and RequireAuth takes over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load('active');
  }, [load]);

  if (failed) {
    return (
      <p role="alert" className="text-red-700">
        Could not load your projects. Please reload the page.
      </p>
    );
  }

  const manage = workspace ? canManage(workspace) : false;
  const replace = (updated: Project) =>
    setProjects((current) => {
      if (!current) return current;
      const archived = updated.archivedAt !== null;
      // A project that moved between the two lists leaves this one.
      if ((filter === 'active') === archived) return current.filter((p) => p.id !== updated.id);
      return current.map((p) => (p.id === updated.id ? updated : p));
    });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Projects</h1>
      {manage && workspace ? (
        <section className="rounded-md border border-slate-200 p-4">
          <h2 className="mb-3 text-lg font-semibold">New project</h2>
          <DetailsForm
            submitLabel="Create project"
            onSubmit={(values) =>
              createProject(workspace, {
                name: values.name,
                description: values.description,
                color: values.color as Project['color'],
                icon: values.icon as Project['icon'],
              })
            }
            onDone={(created) => {
              if (filter === 'active') setProjects((current) => [...(current ?? []), created]);
            }}
          />
        </section>
      ) : null}
      <div role="group" aria-label="Show" className="flex gap-2 text-sm">
        {(['active', 'archived'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              void load(value, workspace);
            }}
            className={`rounded-md border px-3 py-1 ${filter === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}
          >
            {value === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>
      {projects === undefined ? (
        <p role="status" className="text-slate-600">
          Loading…
        </p>
      ) : projects.length === 0 ? (
        <p className="text-slate-600">{filter === 'active' ? 'No projects yet.' : 'No archived projects.'}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} manage={manage} onChanged={replace} />
          ))}
        </ul>
      )}
    </div>
  );
}
