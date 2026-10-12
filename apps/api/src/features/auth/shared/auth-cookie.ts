import type { Response } from 'express';

/** Scoped to /auth so the browser only sends it to refresh/logout, never to business endpoints. */
export const REFRESH_COOKIE_NAME = 'shanflow_refresh';
export const REFRESH_COOKIE_PATH = '/auth';

export interface RefreshCookieOptions {
  secure: boolean;
  domain?: string;
}

function baseOptions(options: RefreshCookieOptions) {
  return {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
    ...(options.domain ? { domain: options.domain } : {}),
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  options: RefreshCookieOptions,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(options),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(
  response: Response,
  options: RefreshCookieOptions,
): void {
  response.clearCookie(REFRESH_COOKIE_NAME, baseOptions(options));
}

/** Minimal Cookie header reader (no parsing library needed for one opaque, URL-safe value). */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}
