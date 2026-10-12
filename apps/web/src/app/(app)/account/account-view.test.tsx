import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { AccountView } from './account-view';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn() }),
}));

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: true };
const serve = (me: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => me }));

beforeEach(() => setSession({ accessToken: 't', expiresAt: Date.now() + 600_000, user }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('AccountView', () => {
  it('offers every security action to a verified password account without Google', async () => {
    serve({ user, security: { hasPassword: true, linkedProviders: [] } });
    render(<AccountView />);
    expect(await screen.findByRole('heading', { name: 'Change password' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Link your Google account' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Verify your email' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out of all devices' })).toBeTruthy();
  });

  it('offers verification to an unverified account and hides linking once Google is linked', async () => {
    serve({ user: { ...user, emailVerified: false }, security: { hasPassword: true, linkedProviders: ['google'] } });
    render(<AccountView />);
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Link your Google account' })).toBeNull();
  });

  it('tells a Google-only account how to add a password instead of showing the change form', async () => {
    serve({ user, security: { hasPassword: false, linkedProviders: ['google'] } });
    render(<AccountView />);
    expect(await screen.findByRole('link', { name: 'Forgot password' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Link your Google account' })).toBeNull();
  });

  it('shows no security actions until the server has answered', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<AccountView />);
    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
