import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBootstrap } from '../shared/bootstrap-store';
import { clearSession, getSession, setSession } from '../shared/session-store';
import { LogoutButtons } from './logout-buttons';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const noContent = { ok: true, status: 204, json: async () => { throw new SyntaxError('empty'); } };

beforeEach(() => {
  replace.mockReset();
  resetBootstrap();
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('LogoutButtons', () => {
  it('signs out this device and goes to /login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContent);
    vi.stubGlobal('fetch', fetchMock);
    render(<LogoutButtons />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3001/auth/logout');
    expect(getSession()).toBeNull();
  });

  it('signs out of all devices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContent);
    vi.stubGlobal('fetch', fetchMock);
    render(<LogoutButtons />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out of all devices' }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3001/auth/logout-all');
  });

  it('disables both buttons while a request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<LogoutButtons />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    const buttons = await screen.findAllByRole('button');
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('keeps the user signed in and shows an error when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    render(<LogoutButtons />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not sign out/);
    expect(replace).not.toHaveBeenCalled();
    expect(getSession()).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
