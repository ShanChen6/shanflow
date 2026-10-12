import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../shared/session-store';
import { ChangePasswordForm } from './change-password-form';
import { submitPasswordChange, validateChange } from './change-password.action';

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: true };
const noContent = { ok: true, status: 204, json: async () => { throw new SyntaxError('empty'); } };
const problem = (status: number, code: string) => ({ ok: false, status, json: async () => ({ type: 't', title: 'x', status, code }) });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('validateChange', () => {
  it('accepts any non-empty current password and enforces the policy on the new one', () => {
    expect(validateChange({ currentPassword: 'x', newPassword: 'x'.repeat(12) })).toEqual({});
    expect(validateChange({ currentPassword: '', newPassword: 'short' })).toEqual({
      currentPassword: 'Enter your current password.',
      newPassword: 'Use 12 to 128 characters.',
    });
  });
});

describe('submitPasswordChange', () => {
  it('posts both passwords with the access token', async () => {
    fetchMock.mockResolvedValue(noContent);
    await expect(submitPasswordChange('old password', 'a new password!')).resolves.toEqual({ status: 'changed' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/password/change');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: 'old password', newPassword: 'a new password!' });
  });

  it.each([
    ['WRONG_PASSWORD', 400, { currentPassword: expect.any(String) }],
    ['PASSWORD_UNCHANGED', 400, { newPassword: expect.any(String) }],
    ['VALIDATION_FAILED', 400, { newPassword: expect.any(String) }],
  ])('maps %s to a field error', async (code, status, fieldErrors) => {
    fetchMock.mockResolvedValue(problem(status, code));
    await expect(submitPasswordChange('a', 'b')).resolves.toMatchObject({ status: 'error', fieldErrors });
  });

  it('maps throttling, a password-less account and network failure to form errors', async () => {
    fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS'));
    await expect(submitPasswordChange('a', 'b')).resolves.toMatchObject({ status: 'error', formError: expect.stringMatching(/Too many/) });
    fetchMock.mockResolvedValue(problem(400, 'PASSWORD_NOT_SET'));
    await expect(submitPasswordChange('a', 'b')).resolves.toMatchObject({ status: 'error', formError: expect.stringMatching(/Forgot password/) });
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(submitPasswordChange('a', 'b')).resolves.toMatchObject({ status: 'error', formError: expect.stringMatching(/Could not change/) });
  });

  it('reports signed-out when the session is gone', async () => {
    fetchMock.mockResolvedValue(problem(401, 'UNAUTHENTICATED'));
    // First 401 triggers one refresh; a rejected refresh means the session is over.
    fetchMock.mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED')).mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED'));
    await expect(submitPasswordChange('a', 'b')).resolves.toEqual({ status: 'signed-out' });
  });
});

describe('ChangePasswordForm', () => {
  async function fill(current: string, next: string) {
    const actor = userEvent.setup();
    await actor.type(screen.getByLabelText('Current password'), current);
    await actor.type(screen.getByLabelText('New password'), next);
    await actor.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('validates locally without a request', async () => {
    render(<ChangePasswordForm />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the fields and confirms that other devices were signed out', async () => {
    fetchMock.mockResolvedValue(noContent);
    render(<ChangePasswordForm />);
    await fill('old password', 'a new password!');
    expect((await screen.findByRole('status')).textContent).toMatch(/other devices were signed out/);
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });

  it('shows a wrong current password on its field and keeps what was typed', async () => {
    fetchMock.mockResolvedValue(problem(400, 'WRONG_PASSWORD'));
    render(<ChangePasswordForm />);
    await fill('guess', 'a new password!');
    expect(await screen.findByText('That is not your current password.')).toBeTruthy();
    expect(screen.getByLabelText('Current password').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('a new password!');
  });
});
