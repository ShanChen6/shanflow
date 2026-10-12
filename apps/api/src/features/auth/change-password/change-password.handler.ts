import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { Clock } from '../../../shared/clock.js';
import { PasswordHasher } from '../../../shared/crypto/password-hasher.js';
import {
  PasswordNotSetError,
  PasswordUnchangedError,
  UnauthenticatedError,
  WrongPasswordError,
} from '../shared/auth.errors.js';
import type { Principal } from '../shared/principal.js';
import { AuthMailService } from '../shared/auth-mail.service.js';
import { RefreshSessionStore } from '../shared/refresh-session.store.js';
import type { ChangePasswordRequest } from './change-password.schema.js';

@Injectable()
export class ChangePasswordHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: RefreshSessionStore,
    private readonly clock: Clock,
    private readonly mail: AuthMailService,
  ) {}

  /**
   * Requires the current password (reauthentication) on top of a live session. Every other device is
   * signed out; the one that made the change stays in. `principal.familyId` is set by SensitiveSessionGuard.
   */
  async execute(
    principal: Principal,
    request: ChangePasswordRequest,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        email: true,
        accountStatus: true,
        passwordCredential: { select: { passwordHash: true } },
      },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
    if (!user.passwordCredential) throw new PasswordNotSetError();

    const currentHash = user.passwordCredential.passwordHash;
    if (!(await this.hasher.verify(currentHash, request.currentPassword)))
      throw new WrongPasswordError();
    if (await this.hasher.verify(currentHash, request.newPassword))
      throw new PasswordUnchangedError();

    const passwordHash = await this.hasher.hash(request.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordCredential.update({
        where: { userId: principal.userId },
        data: { passwordHash, passwordUpdatedAt: this.clock.now() },
      });
      await this.sessions.revokeAllForUser(principal.userId, {
        exceptFamilyId: principal.familyId,
        tx,
      });
    });
    // After the commit, and not awaited: the change stands even if the notice cannot be sent.
    this.mail.sendPasswordChanged(user.email, 'change');
  }
}
