import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { removeAvatar, uploadAvatar, validateAvatarFile } from './avatar.action';
import { AvatarEditor } from './avatar-editor';

const profile = {
  id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11',
  email: 'ann@example.invalid',
  emailVerified: true,
  displayName: 'Ann',
  avatarUrl: null as string | null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T01:00:00.000Z',
};
const reply = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const problem = (status: number, code: string) => reply(status, { type: 't', title: 'x', status, code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession({
    accessToken: 'jwt',
    expiresAt: Date.now() + 600_000,
    user: {
      id: profile.id,
      email: profile.email,
      displayName: 'Ann',
      emailVerified: true,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('validateAvatarFile', () => {
  it('accepts supported small images and rejects the rest', () => {
    expect(validateAvatarFile({ type: 'image/png', size: 1000 })).toBeUndefined();
    expect(validateAvatarFile({ type: 'image/gif', size: 1000 })).toEqual(expect.any(String));
    expect(validateAvatarFile({ type: 'image/png', size: 0 })).toEqual(expect.any(String));
    expect(validateAvatarFile({ type: 'image/png', size: 2 * 1024 * 1024 + 1 })).toEqual(expect.any(String));
  });
});

describe('avatar actions', () => {
  it('uploads raw bytes with the image content type and the bearer token', async () => {
    const updated = {
      ...profile,
      avatarUrl: 'http://localhost:3001/users/x/avatar?v=1',
    };
    fetchMock.mockResolvedValueOnce(reply(200, { user: updated }));
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', {
      type: 'image/png',
    });
    expect(await uploadAvatar(file)).toEqual({
      status: 'updated',
      profile: updated,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/users\/me\/avatar$/);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(file);
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(init.headers.Authorization).toBe('Bearer jwt');
  });

  it('does not call the API for an unsuitable file', async () => {
    const result = await uploadAvatar(new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(result.status).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['PAYLOAD_TOO_LARGE', 413, /2 MB/],
    ['INVALID_IMAGE', 400, /could not be read/],
  ])('maps %s to a friendly message', async (code, status, message) => {
    fetchMock.mockResolvedValueOnce(problem(status as number, code));
    const result = await uploadAvatar(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(result).toEqual({
      status: 'error',
      message: expect.stringMatching(message as RegExp),
    });
  });

  it('removes the avatar with DELETE', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user: profile }));
    expect(await removeAvatar()).toEqual({ status: 'updated', profile });
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
  });
});

describe('AvatarEditor', () => {
  it('uploads a chosen file and reports the new profile', async () => {
    const updated = { ...profile, avatarUrl: 'https://example.invalid/a.webp' };
    fetchMock.mockResolvedValueOnce(reply(200, { user: updated }));
    const onChanged = vi.fn();
    render(<AvatarEditor profile={profile} onChanged={onChanged} />);
    await userEvent.upload(screen.getByLabelText('Choose a profile picture'), new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
  });

  it('offers removal only when there is a picture', async () => {
    const { rerender } = render(<AvatarEditor profile={profile} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
    rerender(<AvatarEditor profile={{ ...profile, avatarUrl: 'https://example.invalid/a.webp' }} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove picture' })).toBeTruthy();
  });

  it('shows the server error', async () => {
    fetchMock.mockResolvedValueOnce(problem(400, 'INVALID_IMAGE'));
    render(<AvatarEditor profile={profile} onChanged={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Choose a profile picture'), new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
