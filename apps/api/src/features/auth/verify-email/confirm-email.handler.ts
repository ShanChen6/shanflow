import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import { InvalidTokenError } from '../shared/auth.errors.js';
import { OneTimeTokenStore } from '../shared/one-time-token.store.js';
import type { ConfirmEmailRequest } from './verify-email.schema.js';

@Injectable()
export class ConfirmEmailHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OneTimeTokenStore,
    private readonly clock: Clock,
  ) {}

  /**
   * Public on purpose: the link is opened from a mailbox, possibly in another browser. The token is the
   * credential. Claim and verification commit together; any failure rolls the claim back.
   */
  async execute(request: ConfirmEmailRequest): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await this.tokens.consume(
        tx,
        request.token,
        'EMAIL_VERIFICATION',
      );
      if (!claimed) throw new InvalidTokenError();
      const user = await tx.user.findUnique({
        where: { id: claimed.userId },
        select: { email: true, accountStatus: true, emailVerifiedAt: true },
      });
      // A link is bound to the address it was sent to: if the account email changed since, it is void.
      if (
        !user ||
        user.accountStatus !== 'ACTIVE' ||
        user.email !== claimed.email
      )
        throw new InvalidTokenError();
      if (user.emailVerifiedAt === null) {
        await tx.user.update({
          where: { id: claimed.userId },
          data: { emailVerifiedAt: this.clock.now() },
        });
      }
    });
  }
}
