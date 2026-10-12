import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBootstrap } from '../session/bootstrap-store';
import { clearSession, setSession } from './session-store';
import { RequireAuth } from './require-auth';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  replace.mockReset();
  resetBootstrap();
});
afterEach(() => {
  // Unmount first: clearing the session while mounted would trigger a restore attempt.
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('RequireAuth', () => {
  it('renders children immediately when a session is already in memory, without refreshing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setSession({ accessToken: 't', expiresAt: Date.now() + 600_000, user });
    render(<RequireAuth><p>secret page</p></RequireAuth>);
    expect(screen.getByText('secret page')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restores the session from the refresh cookie after a reload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900, user })));
    render(<RequireAuth><p>secret page</p></RequireAuth>);
    expect(screen.queryByText('secret page')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(await screen.findByText('secret page')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends visitors without a valid refresh cookie to /login and never shows the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401, { type: 't', title: 'x', status: 401, code: 'UNAUTHENTICATED' })));
    render(<RequireAuth><p>secret page</p></RequireAuth>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('offers a retry instead of signing out when the server is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('failed'));
    vi.stubGlobal('fetch', fetchMock);
    render(<RequireAuth><p>secret page</p></RequireAuth>);
    expect((await screen.findByRole('alert')).textContent).toMatch(/reach the server/);
    expect(replace).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(reply(200, { accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900, user }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('secret page')).toBeTruthy();
  });
});
