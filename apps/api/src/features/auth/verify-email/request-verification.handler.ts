import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../shared/auth.errors.js';
import { EmailVerificationService } from '../shared/email-verification.service.js';
import type { Principal } from '../shared/principal.js';

@Injectable()
export class RequestVerificationHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: EmailVerificationService,
  ) {}

  /** Re-sends the verification link. Already-verified accounts are a silent no-op, so nothing is revealed. */
  async execute(principal: Principal): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        id: true,
        email: true,
        accountStatus: true,
        emailVerifiedAt: true,
      },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
    if (user.emailVerifiedAt !== null) return;
    await this.verification.send(user);
  }
}
