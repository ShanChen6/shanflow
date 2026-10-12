import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordForm } from './reset-password-form';
import { submitPasswordReset, validateNewPassword } from './reset-password.action';

let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

const TOKEN = 'B'.repeat(43);
const noContent = { ok: true, status: 204, json: async () => { throw new SyntaxError('empty'); } };
const problem = (status: number, code: string) => ({ ok: false, status, json: async () => ({ type: 't', title: 'x', status, code }) });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  search = `token=${TOKEN}`;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(newPassword: string, confirm = newPassword) {
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText('New password'), newPassword);
  await actor.type(screen.getByLabelText('Confirm new password'), confirm);
  await actor.click(screen.getByRole('button', { name: 'Update password' }));
}

describe('reset password action', () => {
  it('validates with the contract policy', () => {
    expect(validateNewPassword('x'.repeat(12))).toBe(true);
    expect(validateNewPassword('x'.repeat(11))).toBe(false);
    expect(validateNewPassword('x'.repeat(129))).toBe(false);
  });

  it('posts the token and password, and maps outcomes', async () => {
    fetchMock.mockResolvedValue(noContent);
    await expect(submitPasswordReset(TOKEN, 'a new password!')).resolves.toEqual({ status: 'reset' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/password/reset');
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN, newPassword: 'a new password!' });
    fetchMock.mockResolvedValue(problem(400, 'INVALID_TOKEN'));
    await expect(submitPasswordReset(TOKEN, 'a new password!')).resolves.toEqual({ status: 'invalid-token' });
    fetchMock.mockResolvedValue(problem(400, 'VALIDATION_FAILED'));
    await expect(submitPasswordReset(TOKEN, 'x')).resolves.toEqual({ status: 'weak-password' });
    fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS'));
    await expect(submitPasswordReset(TOKEN, 'x')).resolves.toMatchObject({ status: 'failed' });
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(submitPasswordReset(TOKEN, 'x')).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('ResetPasswordForm', () => {
  it('removes the link token from the address bar', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    render(<ResetPasswordForm />);
    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceState.mockRestore();
  });

  it('checks the policy and the confirmation locally, without a request', async () => {
    render(<ResetPasswordForm />);
    await fill('short');
    expect(await screen.findByText(/Use 12 to 128 characters/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
    render(<ResetPasswordForm />);
    await fill('a long enough password', 'a different confirmation');
    expect(await screen.findByText('The passwords do not match.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updates the password and points to sign-in', async () => {
    fetchMock.mockResolvedValue(noContent);
    render(<ResetPasswordForm />);
    await fill('a long enough password');
    expect(await screen.findByText('Password updated')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ token: TOKEN, newPassword: 'a long enough password' });
  });

  it('asks for a new link when the token is rejected', async () => {
    fetchMock.mockResolvedValue(problem(400, 'INVALID_TOKEN'));
    render(<ResetPasswordForm />);
    await fill('a long enough password');
    expect(await screen.findByText('This link is not valid')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request a new link' }).getAttribute('href')).toBe('/forgot-password');
  });

  it.each([['missing', ''], ['malformed', 'token=nope']])('shows the invalid-link page for a %s token and never submits', (_name, query) => {
    search = query;
    render(<ResetPasswordForm />);
    expect(screen.getByText('This link is not valid')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the form and shows an alert on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    render(<ResetPasswordForm />);
    await fill('a long enough password');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reset/);
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });
});
