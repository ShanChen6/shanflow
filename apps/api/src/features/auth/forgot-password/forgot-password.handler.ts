import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../../../database/normalize-email.js';
import { AuthMailService } from '../shared/auth-mail.service.js';
import { OneTimeTokenStore } from '../shared/one-time-token.store.js';
import type { ForgotPasswordRequest } from './forgot-password.schema.js';

@Injectable()
export class ForgotPasswordHandler {
  private readonly logger = new Logger(ForgotPasswordHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OneTimeTokenStore,
    private readonly mail: AuthMailService,
  ) {}

  /**
   * Always resolves the same way, whether or not the address has an account, so the endpoint cannot be
   * used to discover who is registered. A link is sent only to an active account; accounts without a
   * password (Google-only) may use it to set one, since reading the mailbox proves ownership.
   */
  async execute(request: ForgotPasswordRequest): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(request.email) },
      select: { id: true, email: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== 'ACTIVE') return;
    try {
      const token = await this.tokens.issue(user.id, 'PASSWORD_RESET');
      this.mail.sendPasswordReset(user.email, token);
    } catch {
      // Swallowed on purpose: surfacing a failure here would distinguish real accounts from unknown ones.
      this.logger.error('Could not issue a password reset link.');
    }
  }
}
