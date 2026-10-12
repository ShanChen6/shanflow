import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text only: no HTML, so there is nothing to sanitize or to be spoofed by. */
  text: string;
}

export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/**
 * Development transport: prints the message, including any one-time link, to the API log so flows can be
 * completed without a mail server. Configuration refuses it in production.
 */
@Injectable()
export class ConsoleMailer extends Mailer {
  private readonly logger = new Logger('Mail');

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
    return Promise.resolve();
  }
}

/** Captures messages in memory; used by tests to read one-time links. */
export class InMemoryMailer extends Mailer {
  readonly outbox: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    return Promise.resolve();
  }

  last(to: string): MailMessage | undefined {
    return this.outbox.findLast((message) => message.to === to);
  }
}

export class SmtpMailer extends Mailer {
  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {
    super();
  }

  static fromUrl(url: string, from: string): SmtpMailer {
    return new SmtpMailer(createTransport(url), from);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
