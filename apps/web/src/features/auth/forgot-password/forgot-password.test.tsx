import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordForm } from './forgot-password-form';
import { submitForgotPassword, validateForgotEmail } from './forgot-password.action';

const noContent = { ok: true, status: 202, json: async () => { throw new SyntaxError('empty'); } };
const problem = (status: number, code: string) => ({ ok: false, status, json: async () => ({ type: 't', title: 'x', status, code }) });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('forgot password action', () => {
  it('validates the email with the contract schema', () => {
    expect(validateForgotEmail('a@b.io')).toBe(true);
    expect(validateForgotEmail('nope')).toBe(false);
  });

  it('maps outcomes', async () => {
    fetchMock.mockResolvedValue(noContent);
    await expect(submitForgotPassword('a@b.io')).resolves.toEqual({ status: 'requested' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3001/auth/password/forgot');
    fetchMock.mockResolvedValue(problem(400, 'VALIDATION_FAILED'));
    await expect(submitForgotPassword('a@b.io')).resolves.toEqual({ status: 'invalid-email' });
    fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS'));
    await expect(submitForgotPassword('a@b.io')).resolves.toMatchObject({ status: 'failed', message: expect.stringMatching(/Too many/) });
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(submitForgotPassword('a@b.io')).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('ForgotPasswordForm', () => {
  it('validates locally without a request', async () => {
    render(<ForgotPasswordForm />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the same neutral confirmation whatever the server knows about the address', async () => {
    fetchMock.mockResolvedValue(noContent);
    render(<ForgotPasswordForm />);
    const actor = userEvent.setup();
    await actor.type(screen.getByLabelText('Email'), 'someone@example.invalid');
    await actor.click(screen.getByRole('button', { name: 'Send reset link' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/If an account exists for someone@example.invalid/);
    expect(status.textContent).not.toMatch(/not found|no account|unknown/i);
  });

  it('shows a form-level error when the request fails and re-enables the form', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    render(<ForgotPasswordForm />);
    const actor = userEvent.setup();
    await actor.type(screen.getByLabelText('Email'), 'someone@example.invalid');
    await actor.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not send/);
    expect((screen.getByRole('button', { name: 'Send reset link' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
