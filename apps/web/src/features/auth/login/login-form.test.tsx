import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getSession } from '../shared/session-store';
import { LoginForm } from './login-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };

beforeEach(() => push.mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

async function fill() {
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText('Email'), 'ann@example.invalid');
  await actor.type(screen.getByLabelText('Password'), 'correct horse battery');
  return actor;
}

describe('LoginForm', () => {
  it('validates locally and does not call the API when empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the session in memory and navigates to the account page on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900, user }),
    }));
    render(<LoginForm />);
    const actor = await fill();
    await actor.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/account'));
    expect(getSession()).toMatchObject({ accessToken: 'jwt', user });
    expect(localStorage.length).toBe(0);
  });

  it('shows one generic error for rejected credentials and keeps the user on the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ type: 't', title: 'x', status: 401, code: 'INVALID_CREDENTIALS' }),
    }));
    render(<LoginForm />);
    const actor = await fill();
    await actor.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password.');
    expect(push).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the button while the request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<LoginForm />);
    const actor = await fill();
    await actor.click(screen.getByRole('button', { name: 'Sign in' }));
    const pending = await screen.findByRole('button', { name: /Signing in/ });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
  });
});
