import type { ReactNode } from 'react';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none aria-[invalid=true]:border-red-600';

interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  error?: string;
  hint?: ReactNode;
  disabled?: boolean;
}

/** Labelled input with an accessible error message; shared by the newer auth forms. */
export function TextField({ id, name, label, type = 'text', autoComplete, error, hint, disabled }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-500 px-4 py-2 font-medium text-brand-ink disabled:opacity-60"
    >
      {pending ? busy : idle}
    </button>
  );
}
