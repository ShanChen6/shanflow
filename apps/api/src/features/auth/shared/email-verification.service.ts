import { Injectable } from '@nestjs/common';
import { AuthMailService } from './auth-mail.service.js';
import { OneTimeTokenStore } from './one-time-token.store.js';

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly tokens: OneTimeTokenStore,
    private readonly mail: AuthMailService,
  ) {}

  /** Issues a link bound to the user's current email (replacing any earlier one) and emails it. */
  async send(user: { id: string; email: string }): Promise<void> {
    const token = await this.tokens.issue(user.id, 'EMAIL_VERIFICATION', {
      email: user.email,
    });
    this.mail.sendEmailVerification(user.email, token);
  }
}
