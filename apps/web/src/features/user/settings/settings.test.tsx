import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { loadSettings, saveSettings } from './settings.action';
import { SettingsView } from './settings-view';

const defaults = { locale: 'en', timeZone: 'UTC', theme: 'system' };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({
    accessToken: 'jwt',
    expiresAt: Date.now() + 600_000,
    user: { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@example.invalid', displayName: 'A', emailVerified: true },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('settings actions', () => {
  it('loads settings with the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { settings: defaults }));
    expect(await loadSettings()).toEqual({ status: 'ready', settings: defaults });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer jwt');
  });

  it('sends only the changed field and returns the stored settings', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { settings: { ...defaults, theme: 'dark' } }));
    expect(await saveSettings({ theme: 'dark' })).toEqual({ status: 'saved', settings: { ...defaults, theme: 'dark' } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ theme: 'dark' });
  });

  it('does not call the API for invalid input and maps server failures', async () => {
    expect((await saveSettings({ timeZone: 'Mars/Base' })).status).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(problem(429, 'TOO_MANY_REQUESTS'));
    expect(await saveSettings({ theme: 'dark' })).toEqual({ status: 'error', message: expect.stringContaining('Too many') });
  });
});

describe('SettingsView', () => {
  it('shows the current values and saves a change', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { settings: defaults }));
    fetchMock.mockResolvedValueOnce(reply(200, { settings: { ...defaults, locale: 'vi' } }));
    render(<SettingsView />);
    const language = (await screen.findByLabelText('Language')) as HTMLSelectElement;
    expect(language.value).toBe('en');
    await userEvent.selectOptions(language, 'vi');
    await waitFor(() => expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('vi'));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('shows an error when loading fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<SettingsView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
