import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import type { Principal } from '../../auth/shared/principal.js';
import { PROFILE_SELECT, toProfile } from '../shared/profile.mapper.js';
import type {
  UpdateProfileRequest,
  UpdateProfileResponse,
} from './update-profile.schema.js';

@Injectable()
export class UpdateProfileHandler {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Changes the caller's own display name. The target is the id in the verified token, and the account must be
   * ACTIVE, so a suspended account cannot edit itself with a token that has not expired yet.
   */
  async execute(
    principal: Principal,
    request: UpdateProfileRequest,
  ): Promise<UpdateProfileResponse> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: principal.userId, accountStatus: 'ACTIVE' },
      data: { displayName: request.displayName },
    });
    if (count !== 1) throw new UnauthenticatedError();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: PROFILE_SELECT,
    });
    return { user: toProfile(user) };
  }
}
