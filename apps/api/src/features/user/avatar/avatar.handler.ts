import { Injectable, Logger } from '@nestjs/common';
import { AVATAR_CONTENT_TYPES } from '@shanflow/contracts';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import type { Principal } from '../../auth/shared/principal.js';
import { AvatarStorage, newAvatarKey } from '../shared/avatar-storage.js';
import { processAvatar } from '../shared/avatar-image.js';
import { PROFILE_SELECT, ProfileService } from '../shared/profile.mapper.js';
import {
  NotFoundError,
  UnsupportedMediaTypeError,
} from '../shared/user.errors.js';
import type { Tx } from '../../auth/shared/transaction.js';

export interface AvatarFile {
  bytes: Buffer;
  /** Changes with every upload; used as the ETag. */
  version: number;
}

@Injectable()
export class AvatarHandler {
  private readonly logger = new Logger(AvatarHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AvatarStorage,
    private readonly profiles: ProfileService,
    private readonly clock: Clock,
  ) {}

  private async requireActive(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
  }

  /** Locks the user's row for the rest of the transaction and returns the avatar key it currently holds. */
  private async lockAndReadKey(tx: Tx, userId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<
      Array<{ avatar_storage_key: string | null }>
    >`
      SELECT avatar_storage_key FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    return rows[0]?.avatar_storage_key ?? null;
  }

  private async deleteQuietly(key: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch {
      // The old file is garbage now; failing to remove it must not fail the request.
      this.logger.error('Could not delete a replaced avatar file.');
    }
  }

  async upload(
    principal: Principal,
    declaredType: string | undefined,
    bytes: Buffer,
  ) {
    // The declared type is only a first filter; processAvatar decides from the real bytes.
    const mime = declaredType?.split(';')[0]?.trim().toLowerCase();
    if (!mime || !(AVATAR_CONTENT_TYPES as readonly string[]).includes(mime))
      throw new UnsupportedMediaTypeError();
    await this.requireActive(principal.userId);

    const image = await processAvatar(bytes);
    const key = newAvatarKey(principal.userId);
    await this.storage.put(key, image);

    let previousKey: string | null;
    try {
      previousKey = await this.prisma.$transaction(async (tx) => {
        // Serialises concurrent uploads, so exactly one old file is replaced and none is orphaned.
        const old = await this.lockAndReadKey(tx, principal.userId);
        const { count } = await tx.user.updateMany({
          where: { id: principal.userId, accountStatus: 'ACTIVE' },
          data: { avatarStorageKey: key, avatarUpdatedAt: this.clock.now() },
        });
        if (count !== 1) throw new UnauthenticatedError();
        return old;
      });
    } catch (error) {
      await this.deleteQuietly(key); // the new file was never attached to anyone
      throw error;
    }
    await this.deleteQuietly(previousKey);
    return this.currentProfile(principal.userId);
  }

  /** Removes the uploaded avatar and any external picture, leaving the user with no avatar. */
  async remove(principal: Principal) {
    await this.requireActive(principal.userId);
    const previousKey = await this.prisma.$transaction(async (tx) => {
      const old = await this.lockAndReadKey(tx, principal.userId);
      await tx.user.updateMany({
        where: { id: principal.userId, accountStatus: 'ACTIVE' },
        data: {
          avatarStorageKey: null,
          avatarUpdatedAt: null,
          avatarUrl: null,
        },
      });
      return old;
    });
    await this.deleteQuietly(previousKey);
    return this.currentProfile(principal.userId);
  }

  /** Public read of an avatar by user id. Unknown user, no avatar and suspended account are indistinguishable. */
  async read(userId: string): Promise<AvatarFile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        avatarStorageKey: true,
        avatarUpdatedAt: true,
      },
    });
    if (
      !user ||
      user.accountStatus !== 'ACTIVE' ||
      !user.avatarStorageKey ||
      !user.avatarUpdatedAt
    )
      throw new NotFoundError();
    const bytes = await this.storage.get(user.avatarStorageKey);
    if (!bytes) {
      this.logger.error('An avatar file is missing from storage.');
      throw new NotFoundError();
    }
    return { bytes, version: user.avatarUpdatedAt.getTime() };
  }

  private async currentProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    return { user: this.profiles.toProfile(user) };
  }
}
