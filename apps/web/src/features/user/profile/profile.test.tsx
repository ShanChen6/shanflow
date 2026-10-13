import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getSession, setSession } from '@/features/auth/shared/session-store';
import { loadProfile, submitDisplayName, validateDisplayName } from './profile.action';
import { ProfileView } from './profile-view';

const sessionUser = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: true };
const profile = {
  ...sessionUser,
  avatarUrl: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T01:00:00.000Z',
};
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user: sessionUser });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('validateDisplayName', () => {
  it('uses the same rules as the API', () => {
    expect(validateDisplayName('Ann')).toBeUndefined();
    expect(validateDisplayName('  Ann  ')).toBeUndefined();
    for (const bad of ['', '   ', 'n'.repeat(81), 'Ann\nBob', 'Ann‮txt', 'Ann​Bob']) {
      expect(validateDisplayName(bad)).toEqual(expect.any(String));
    }
  });
});

describe('profile actions', () => {
  it('loads the profile with the access token', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: profile }));
    await expect(loadProfile()).resolves.toEqual({ status: 'ready', profile });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/users/me');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
  });

  it('reports errors and a lost session', async () => {
    fetchMock.mockResolvedValue(reply(500, { type: 't', title: 'x', status: 500, code: 'INTERNAL_ERROR' }));
    await expect(loadProfile()).resolves.toEqual({ status: 'error' });
    fetchMock.mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED')).mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED'));
    await expect(loadProfile()).resolves.toEqual({ status: 'signed-out' });
  });

  it('sends only the display name by PATCH and refreshes the in-memory session name', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: { ...profile, displayName: 'Anh' } }));
    await expect(submitDisplayName('Anh')).resolves.toMatchObject({ status: 'updated', profile: { displayName: 'Anh' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/users/me');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ displayName: 'Anh' });
    expect(getSession()?.user.displayName).toBe('Anh');
    expect(getSession()?.accessToken).toBe('jwt');
  });

  it('does not call the API for an invalid name', async () => {
    await expect(submitDisplayName('  ')).resolves.toMatchObject({ status: 'error', nameError: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['VALIDATION_FAILED', 400, { nameError: expect.any(String) }],
    ['TOO_MANY_REQUESTS', 429, { formError: expect.stringMatching(/Too many/) }],
  ])('maps %s', async (code, status, expected) => {
    fetchMock.mockResolvedValue(problem(status, code));
    await expect(submitDisplayName('Anh')).resolves.toMatchObject({ status: 'error', ...expected });
    expect(getSession()?.user.displayName).toBe('Ann');
  });

  it('reports a network failure without changing the session', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(submitDisplayName('Anh')).resolves.toMatchObject({ status: 'error', formError: expect.stringMatching(/Could not save/) });
    expect(getSession()?.user.displayName).toBe('Ann');
  });
});

describe('ProfileView', () => {
  it('shows the profile with an initial when there is no avatar', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: profile }));
    render(<ProfileView />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(await screen.findByRole('heading', { name: 'Ann' })).toBeTruthy();
    expect(screen.getByText(/ann@example.invalid/)).toBeTruthy();
    expect(screen.getByText(/Member since/)).toBeTruthy();
    expect(screen.queryByText('(not verified)')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('shows an https avatar without leaking the referrer, and the unverified flag', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: { ...profile, emailVerified: false, avatarUrl: 'https://images.example.invalid/a.png' } }));
    render(<ProfileView />);
    await screen.findByRole('heading', { name: 'Ann' });
    const image = document.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://images.example.invalid/a.png');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText('(not verified)')).toBeTruthy();
  });

  it('shows an error when the profile cannot be loaded', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    render(<ProfileView />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load/);
  });

  it('saves a new name and shows the server\'s normalised value everywhere', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user: profile })).mockResolvedValueOnce(reply(200, { user: { ...profile, displayName: 'Anh Nguyễn' } }));
    render(<ProfileView />);
    const input = (await screen.findByLabelText('Display name')) as HTMLInputElement;
    const actor = userEvent.setup();
    await actor.clear(input);
    await actor.type(input, '  Anh Nguyễn  ');
    await actor.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Name updated.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Anh Nguyễn' })).toBeTruthy();
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Anh Nguyễn');
  });

  it('shows an invalid name on the field and does not call the API', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user: profile }));
    render(<ProfileView />);
    const input = (await screen.findByLabelText('Display name')) as HTMLInputElement;
    const actor = userEvent.setup();
    await actor.clear(input);
    await actor.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText(/1 to 80 characters/)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the form and shows an alert when saving fails, then allows a retry', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user: profile })).mockRejectedValueOnce(new TypeError('failed'));
    render(<ProfileView />);
    const input = (await screen.findByLabelText('Display name')) as HTMLInputElement;
    const actor = userEvent.setup();
    await actor.clear(input);
    await actor.type(input, 'Anh');
    await actor.click(screen.getByRole('button', { name: 'Save name' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not save/);
    expect(input.value).toBe('Anh');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
