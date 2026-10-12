import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import type { Principal } from '../../auth/shared/principal.js';
import type { GetUserMeResponse } from './me.schema.js';

/** Only an https image URL is ever handed to a client; anything else stored in the database becomes "no avatar". */
export function safeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

@Injectable()
export class GetMeHandler {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own profile. The id comes from the verified token, never from the request. */
  async execute(principal: Principal): Promise<GetUserMeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      // An explicit allow-list: credentials, status and relations are never selected.
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        displayName: true,
        avatarUrl: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // A valid token can outlive its account: removed or suspended users are treated as signed out.
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
    return {
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        displayName: user.displayName,
        avatarUrl: safeAvatarUrl(user.avatarUrl),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    };
  }
}
