import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from './register-form';

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };

afterEach(() => vi.unstubAllGlobals());

async function fill(password = 'correct horse battery') {
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText('Name'), 'Ann');
  await actor.type(screen.getByLabelText('Email'), 'ann@example.invalid');
  await actor.type(screen.getByLabelText('Password'), password);
  return actor;
}

describe('RegisterForm', () => {
  it('shows field errors and does not call the API when input is invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm />);
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits, disables the button while pending and shows the success state', async () => {
    let finish: (value: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm />);
    const actor = await fill();
    await actor.click(screen.getByRole('button', { name: 'Create account' }));
    const pending = await screen.findByRole('button', { name: /Creating account/ });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true, status: 201, json: async () => ({ user }) });
    expect(await screen.findByText(/ann@example.invalid is registered/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a duplicate-email error on the email field and re-enables the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ type: 't', title: 'x', status: 409, code: 'EMAIL_ALREADY_REGISTERED' }),
    }));
    render(<RegisterForm />);
    const actor = await fill();
    await actor.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists.')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('shows a form-level alert when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    render(<RegisterForm />);
    const actor = await fill();
    await actor.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/reach the server/);
  });

  it('never renders the password back to the user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'x' }) }));
    const { container } = render(<RegisterForm />);
    const actor = await fill('my secret passphrase');
    await actor.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    expect(container.textContent).not.toContain('my secret passphrase');
  });
});
