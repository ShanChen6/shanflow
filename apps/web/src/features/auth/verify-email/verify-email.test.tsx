import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../shared/session-store';
import { ResendVerification } from './resend-verification';
import { requestVerificationEmail, submitEmailConfirmation } from './verify-email.action';
import { VerifyEmailPanel } from './verify-email-panel';

let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

const TOKEN = 'A'.repeat(43);
const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const noContent = (status = 204) => ({ ok: true, status, json: async () => { throw new SyntaxError('empty'); } });
const problem = (status: number, code: string) => ({ ok: false, status, json: async () => ({ type: 't', title: 'x', status, code }) });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  search = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('submitEmailConfirmation', () => {
  it('posts the token without credentials headers and reports confirmed', async () => {
    fetchMock.mockResolvedValue(noContent());
    await expect(submitEmailConfirmation(TOKEN)).resolves.toEqual({ status: 'confirmed' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/email-verification/confirm');
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it.each([
    ['an invalid token', () => fetchMock.mockResolvedValue(problem(400, 'INVALID_TOKEN')), { status: 'invalid' }],
    ['a malformed token', () => fetchMock.mockResolvedValue(problem(400, 'VALIDATION_FAILED')), { status: 'invalid' }],
    ['throttling', () => fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS')), { status: 'failed' }],
    ['a network failure', () => fetchMock.mockRejectedValue(new TypeError('failed')), { status: 'failed' }],
  ])('maps %s', async (_name, arrange, expected) => {
    arrange();
    await expect(submitEmailConfirmation(TOKEN)).resolves.toMatchObject(expected);
  });
});

describe('requestVerificationEmail', () => {
  beforeEach(() => setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user }));

  it('posts with the access token and reports sent', async () => {
    fetchMock.mockResolvedValue(noContent(202));
    await expect(requestVerificationEmail()).resolves.toBe('sent');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/email-verification/request');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
  });

  it('maps throttling and other failures', async () => {
    fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS'));
    await expect(requestVerificationEmail()).resolves.toBe('throttled');
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(requestVerificationEmail()).resolves.toBe('failed');
  });
});

describe('VerifyEmailPanel', () => {
  it('waits for an explicit click before consuming the token, then confirms', async () => {
    search = `token=${TOKEN}`;
    fetchMock.mockResolvedValue(noContent());
    render(<VerifyEmailPanel />);
    expect(fetchMock).not.toHaveBeenCalled(); // a link scanner opening the page must not use the token up
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm email' }));
    expect(await screen.findByText('Email confirmed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your account' }).getAttribute('href')).toBe('/account');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes the token from the address bar', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    search = `token=${TOKEN}`;
    render(<VerifyEmailPanel />);
    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceState.mockRestore();
  });

  it.each([['missing', ''], ['malformed', 'token=short']])('shows an invalid-link message for a %s token without any request', (_name, query) => {
    search = query;
    render(<VerifyEmailPanel />);
    expect(screen.getByText('This link is not valid')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains an expired or used link, and offers a retry on a network failure', async () => {
    search = `token=${TOKEN}`;
    fetchMock.mockRejectedValueOnce(new TypeError('failed'));
    render(<VerifyEmailPanel />);
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'Confirm email' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not confirm/);
    fetchMock.mockResolvedValueOnce(problem(400, 'INVALID_TOKEN'));
    await actor.click(screen.getByRole('button', { name: 'Confirm email' }));
    expect(await screen.findByText('This link is not valid')).toBeTruthy();
  });
});

describe('ResendVerification', () => {
  beforeEach(() => setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user }));

  it('sends and confirms without claiming the address exists or not', async () => {
    fetchMock.mockResolvedValue(noContent(202));
    render(<ResendVerification />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send verification email' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/new link is on its way/);
  });

  it('shows a throttling message', async () => {
    fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS'));
    render(<ResendVerification />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send verification email' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many requests/);
  });
});
