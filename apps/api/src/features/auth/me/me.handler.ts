import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../shared/auth.errors.js';
import type { Principal } from '../shared/principal.js';
import type { MeResponse } from './me.schema.js';

@Injectable()
export class MeHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: Principal): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountStatus: true,
        emailVerifiedAt: true,
        passwordCredential: { select: { userId: true } },
        oauthAccounts: { select: { provider: true } },
      },
    });
    // A valid token can outlive its account: removed or suspended users are treated as signed out.
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerifiedAt !== null,
      },
      security: {
        hasPassword: user.passwordCredential !== null,
        linkedProviders: user.oauthAccounts.map(() => 'google' as const),
      },
    };
  }
}
