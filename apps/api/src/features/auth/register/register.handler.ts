import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '../../../shared/crypto/password-hasher.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../../../database/normalize-email.js';
import { EmailAlreadyRegisteredError } from '../shared/auth.errors.js';
import type { RegisterRequest, RegisterResponse } from './register.schema.js';

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION;
}

@Injectable()
export class RegisterHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(request: RegisterRequest): Promise<RegisterResponse> {
    const email = normalizeEmail(request.email);
    // Hash before touching the database so no connection or lock is held during the CPU-bound work.
    const passwordHash = await this.hasher.hash(request.password);
    try {
      // Nested create runs as one statement group, so the user and credential commit together.
      const user = await this.prisma.user.create({
        data: {
          email,
          displayName: request.displayName,
          passwordCredential: { create: { passwordHash } },
        },
        select: { id: true, email: true, displayName: true, emailVerifiedAt: true },
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerifiedAt !== null,
        },
      };
    } catch (error) {
      // The unique index on users.email is the authority, so concurrent signups are safe.
      if (isUniqueViolation(error)) throw new EmailAlreadyRegisteredError();
      throw error;
    }
  }
}
