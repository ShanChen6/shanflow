import { API_BASE_URL } from '@/shared/config';

/** A plain navigation to the API, which redirects to Google: no script needed and nothing to leak. */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  return (
    <a
      href={`${API_BASE_URL}/auth/google/start`}
      className="rounded-md border border-slate-300 px-4 py-2 text-center font-medium hover:bg-slate-50"
    >
      {label}
    </a>
  );
}
