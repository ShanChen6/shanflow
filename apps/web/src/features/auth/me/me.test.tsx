import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../shared/session-store';
import { LinkedNotice } from './linked-notice';
import { MeSummary } from './me-summary';
import { useMe } from './use-me';

let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  search = '';
  setSession({ accessToken: 't', expiresAt: Date.now() + 600_000, user });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('useMe', () => {
  it('loads the profile and sign-in methods', async () => {
    const me = { user, security: { hasPassword: true, linkedProviders: ['google'] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, me)));
    const { result } = renderHook(() => useMe());
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current).toEqual({ state: 'ready', me }));
  });

  it('reports an error when the profile cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(500, { type: 't', title: 'x', status: 500, code: 'INTERNAL_ERROR' })));
    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.state).toBe('error'));
  });
});

describe('MeSummary', () => {
  it('shows the session profile while loading and no sign-in methods yet', () => {
    render(<MeSummary me={{ state: 'loading' }} />);
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('(not verified)')).toBeTruthy();
    expect(screen.queryByText('Sign-in methods')).toBeNull();
  });

  it('lists the sign-in methods from the server', () => {
    render(<MeSummary me={{ state: 'ready', me: { user: { ...user, displayName: 'Server Ann', emailVerified: true }, security: { hasPassword: true, linkedProviders: ['google'] } } }} />);
    expect(screen.getByText('Server Ann')).toBeTruthy();
    expect(screen.getByText('Password, Google')).toBeTruthy();
    expect(screen.queryByText('(not verified)')).toBeNull();
  });

  it('keeps the known profile and alerts when the refresh failed', () => {
    render(<MeSummary me={{ state: 'error' }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Could not refresh/);
    expect(screen.getByText('Ann')).toBeTruthy();
  });
});

describe('LinkedNotice', () => {
  it('confirms a completed link only for the exact value', () => {
    search = 'linked=google';
    const { container, rerender } = render(<LinkedNotice />);
    expect(screen.getByRole('status').textContent).toMatch(/now linked/);
    search = 'linked=<b>x</b>';
    rerender(<LinkedNotice />);
    expect(container.textContent).toBe('');
  });
});
