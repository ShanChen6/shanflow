import { Injectable, Logger } from '@nestjs/common';
import { PasswordHasher } from '../../../shared/crypto/password-hasher.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../../../database/normalize-email.js';
import { EmailAlreadyRegisteredError } from '../shared/auth.errors.js';
import { EmailVerificationService } from '../shared/email-verification.service.js';
import type { RegisterRequest, RegisterResponse } from './register.schema.js';

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class RegisterHandler {
  private readonly logger = new Logger(RegisterHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly verification: EmailVerificationService,
  ) {}

  async execute(request: RegisterRequest): Promise<RegisterResponse> {
    const email = normalizeEmail(request.email);
    // Hash before touching the database so no connection or lock is held during the CPU-bound work.
    const passwordHash = await this.hasher.hash(request.password);
    let user;
    try {
      // Nested create runs as one statement group, so the user and credential commit together.
      user = await this.prisma.user.create({
        data: {
          email,
          displayName: request.displayName,
          passwordCredential: { create: { passwordHash } },
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          emailVerifiedAt: true,
        },
      });
    } catch (error) {
      // The unique index on users.email is the authority, so concurrent signups are safe.
      if (isUniqueViolation(error)) throw new EmailAlreadyRegisteredError();
      throw error;
    }

    // The account exists either way: a failure to prepare the email must not fail the signup.
    // The user can request another link from the account page.
    try {
      await this.verification.send(user);
    } catch {
      this.logger.error(
        'Could not issue the email verification link for a new account.',
      );
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerifiedAt !== null,
      },
    };
  }
}
