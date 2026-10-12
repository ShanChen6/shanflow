import type { UserProfile } from '@shanflow/contracts';

/** Only an https image URL is ever handed to a client; anything else stored in the database becomes "no avatar". */
export function safeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** An explicit allow-list: credentials and relations are never selected for a profile. */
export const PROFILE_SELECT = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  displayName: true,
  avatarUrl: true,
  accountStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface StoredProfile {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toProfile(user: StoredProfile): UserProfile {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    displayName: user.displayName,
    avatarUrl: safeAvatarUrl(user.avatarUrl),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
