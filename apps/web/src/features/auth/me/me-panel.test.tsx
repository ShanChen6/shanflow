import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../shared/session-store';
import { MePanel } from './me-panel';

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe('MePanel', () => {
  it('shows the profile from the server with the verification state', async () => {
    setSession({ accessToken: 't', expiresAt: Date.now() + 600_000, user: { ...user, displayName: 'Stale Name' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { user })));
    render(<MePanel />);
    expect(screen.getByText('Stale Name')).toBeTruthy();
    expect(await screen.findByText('Ann')).toBeTruthy();
    expect(screen.getByText('(not verified)')).toBeTruthy();
  });

  it('keeps the known profile and shows an alert when the refresh fails', async () => {
    setSession({ accessToken: 't', expiresAt: Date.now() + 600_000, user });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(500, { type: 't', title: 'x', status: 500, code: 'INTERNAL_ERROR' })));
    render(<MePanel />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not refresh/);
    expect(screen.getByText('Ann')).toBeTruthy();
  });
});
