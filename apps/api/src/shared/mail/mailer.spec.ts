import { createTransport } from 'nodemailer';
import { InMemoryMailer, SmtpMailer } from './mailer.js';

describe('InMemoryMailer', () => {
  it('records messages and finds the latest for a recipient', async () => {
    const mailer = new InMemoryMailer();
    await mailer.send({
      to: 'a@example.invalid',
      subject: 'one',
      text: 'first',
    });
    await mailer.send({
      to: 'b@example.invalid',
      subject: 'two',
      text: 'other',
    });
    await mailer.send({
      to: 'a@example.invalid',
      subject: 'three',
      text: 'latest',
    });
    expect(mailer.last('a@example.invalid')?.text).toBe('latest');
    expect(mailer.last('nobody@example.invalid')).toBeUndefined();
  });
});

describe('SmtpMailer', () => {
  it('hands a plain-text message with the configured sender to the transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    await new SmtpMailer({ sendMail }, 'Shanflow <no-reply@example.com>').send({
      to: 'ann@example.invalid',
      subject: 'Hello',
      text: 'Body',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Shanflow <no-reply@example.com>',
      to: 'ann@example.invalid',
      subject: 'Hello',
      text: 'Body',
    });
  });

  it('propagates transport failures so callers can log them', async () => {
    const mailer = new SmtpMailer(
      { sendMail: vi.fn().mockRejectedValue(new Error('smtp down')) },
      'a@b.io',
    );
    await expect(
      mailer.send({ to: 'x@example.invalid', subject: 's', text: 't' }),
    ).rejects.toThrow('smtp down');
  });

  it('produces a plain-text MIME message and cannot be used for header injection', async () => {
    const real = createTransport({ streamTransport: true, buffer: true });
    let raw = '';
    const capture = {
      sendMail: (async (message: Parameters<typeof real.sendMail>[0]) => {
        const info = await real.sendMail(message);
        raw = (info as unknown as { message: Buffer }).message.toString('utf8');
        return info;
      }) as typeof real.sendMail,
    };
    await new SmtpMailer(capture, 'Shanflow <no-reply@example.com>').send({
      to: 'ann@example.invalid',
      subject: 'Verify\r\nBcc: evil@example.invalid',
      text: 'plain body',
    });
    const headers = raw.split(/\r?\n\r?\n/)[0] ?? '';
    expect(headers).toMatch(/^From: .*no-reply@example\.com/m);
    expect(headers).toMatch(/Content-Type: text\/plain/);
    expect(raw).not.toMatch(/text\/html/);
    expect(headers).not.toMatch(/^Bcc:/im);
    expect(raw).toContain('plain body');
  });
});
