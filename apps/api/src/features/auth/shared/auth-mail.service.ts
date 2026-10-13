import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../../../config/auth.config.js';
import { Mailer, type MailMessage } from '../../../shared/mail/mailer.js';

/** Builds and dispatches the account emails. Plain text, one link each, no tracking. */
@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    private readonly mailer: Mailer,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  sendEmailVerification(to: string, token: string): void {
    this.dispatch({
      to,
      subject: 'Verify your Shanflow email',
      text: [
        'Confirm that this is your email address to finish setting up your Shanflow account.',
        '',
        `${this.config.WEB_ORIGIN}/verify-email?token=${token}`,
        '',
        'This link works once and expires in 24 hours. If you did not create an account, ignore this email.',
      ].join('\n'),
    });
  }

  sendPasswordReset(to: string, token: string): void {
    this.dispatch({
      to,
      subject: 'Reset your Shanflow password',
      text: [
        'Use this link to choose a new Shanflow password.',
        '',
        `${this.config.WEB_ORIGIN}/reset-password?token=${token}`,
        '',
        'This link works once and expires in 1 hour. If you did not ask for it, ignore this email: your password has not changed.',
      ].join('\n'),
    });
  }

  /** Tells the owner their password changed, so a takeover does not go unnoticed. Carries no secret. */
  sendPasswordChanged(to: string, reason: 'change' | 'reset'): void {
    this.dispatch({
      to,
      subject: 'Your Shanflow password was changed',
      text: [
        reason === 'reset'
          ? 'The password for your Shanflow account was just reset, and you were signed out on every device.'
          : 'The password for your Shanflow account was just changed, and your other devices were signed out.',
        '',
        'If this was you, no action is needed.',
        '',
        `If it was not you, reset your password now: ${this.config.WEB_ORIGIN}/forgot-password`,
      ].join('\n'),
    });
  }

  /**
   * Not awaited: callers answer immediately, so response time never reveals whether an address has an
   * account. Failures are logged without the recipient or the link (which carries a live token).
   */
  private dispatch(message: MailMessage): void {
    void this.mailer.send(message).catch((error: unknown) => {
      this.logger.error(
        `Failed to send "${message.subject}" email (${error instanceof Error ? error.name : 'unknown error'}).`,
      );
    });
  }
}
