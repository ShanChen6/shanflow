import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OAUTH_ERROR_CODES } from '@shanflow/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../shared/session-store';
import { startGoogleLink } from './google.action';
import { GoogleButton } from './google-button';
import { LinkGoogleForm } from './link-google-form';
import { OAuthErrorBanner } from './oauth-error-banner';
import { messageForOAuthError } from './oauth-messages';

let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: true };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user });
  search = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('oauth error messages', () => {
  it('maps every code the API can send and nothing else', () => {
    for (const code of OAUTH_ERROR_CODES) expect(messageForOAuthError(code)).toEqual(expect.any(String));
    for (const hostile of ['<script>alert(1)</script>', 'unknown', '', null, undefined]) {
      expect(messageForOAuthError(hostile)).toBeUndefined();
    }
  });

  it('tells the user to sign in with their password when the email already has an account', () => {
    expect(messageForOAuthError('account_exists')).toMatch(/password/);
  });

  it('renders the banner for a known code and nothing for others', () => {
    search = 'error=account_exists';
    const { container, rerender } = render(<OAuthErrorBanner />);
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
    search = 'error=%3Cscript%3E';
    rerender(<OAuthErrorBanner />);
    expect(container.textContent).toBe('');
  });
});

describe('GoogleButton', () => {
  it('is a plain link to the API start endpoint', () => {
    render(<GoogleButton />);
    expect(screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('href')).toBe('http://localhost:3001/auth/google/start');
  });
});

describe('startGoogleLink', () => {
  it('posts the password and returns the Google URL', async () => {
    fetchMock.mockResolvedValue(reply(200, { authorizationUrl: 'https://accounts.example.invalid/auth?x=1' }));
    await expect(startGoogleLink('secret pass')).resolves.toEqual({ status: 'redirect', url: 'https://accounts.example.invalid/auth?x=1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/google/link/start');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(JSON.parse(String(init.body))).toEqual({ password: 'secret pass' });
  });

  it.each([
    ['WRONG_PASSWORD', 400, { passwordError: expect.any(String) }],
    ['VALIDATION_FAILED', 400, { passwordError: expect.any(String) }],
    ['ALREADY_LINKED', 409, { formError: expect.stringMatching(/already linked/) }],
    ['OAUTH_NOT_CONFIGURED', 503, { formError: expect.stringMatching(/not available/) }],
    ['TOO_MANY_REQUESTS', 429, { formError: expect.stringMatching(/Too many/) }],
  ])('maps %s', async (code, status, expected) => {
    fetchMock.mockResolvedValue(problem(status, code));
    await expect(startGoogleLink('x')).resolves.toMatchObject({ status: 'error', ...expected });
  });

  it('reports an unexpected response as a generic failure', async () => {
    fetchMock.mockResolvedValue(reply(200, { authorizationUrl: 'not a url' }));
    await expect(startGoogleLink('x')).resolves.toMatchObject({ status: 'error', formError: expect.stringMatching(/Could not start/) });
  });
});

describe('LinkGoogleForm', () => {
  it('requires the password before doing anything', async () => {
    render(<LinkGoogleForm />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Link Google account' }));
    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the browser to Google after the password is confirmed', async () => {
    fetchMock.mockResolvedValue(reply(200, { authorizationUrl: 'https://accounts.example.invalid/auth?x=1' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<LinkGoogleForm />);
    const actor = userEvent.setup();
    await actor.type(screen.getByLabelText('Current password'), 'my password');
    await actor.click(screen.getByRole('button', { name: 'Link Google account' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.example.invalid/auth?x=1'));
  });

  it('shows a wrong password on its field and stays on the page', async () => {
    fetchMock.mockResolvedValue(problem(400, 'WRONG_PASSWORD'));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<LinkGoogleForm />);
    const actor = userEvent.setup();
    await actor.type(screen.getByLabelText('Current password'), 'nope');
    await actor.click(screen.getByRole('button', { name: 'Link Google account' }));
    expect(await screen.findByText('That is not your current password.')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Link Google account' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
