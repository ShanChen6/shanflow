import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { UserProfile } from '@shanflow/contracts';
import { userConfig } from '../../../config/user.config.js';

/** Only an https image URL is ever handed to a client from an external source; anything else becomes "no avatar". */
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
  avatarStorageKey: true,
  avatarUpdatedAt: true,
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
  avatarStorageKey: string | null;
  avatarUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProfileService {
  constructor(
    @Inject(userConfig.KEY)
    private readonly config: ConfigType<typeof userConfig>,
  ) {}

  /**
   * An uploaded avatar wins and is served by this API at a URL versioned by its change time (so browsers can cache
   * it forever and still see a new upload at once). Otherwise an external provider picture is used if it is https.
   */
  avatarUrlFor(
    user: Pick<
      StoredProfile,
      'id' | 'avatarUrl' | 'avatarStorageKey' | 'avatarUpdatedAt'
    >,
  ): string | null {
    if (user.avatarStorageKey && user.avatarUpdatedAt) {
      return `${this.config.API_PUBLIC_URL}/users/${user.id}/avatar?v=${user.avatarUpdatedAt.getTime()}`;
    }
    return safeAvatarUrl(user.avatarUrl);
  }

  toProfile(user: StoredProfile): UserProfile {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      displayName: user.displayName,
      avatarUrl: this.avatarUrlFor(user),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
