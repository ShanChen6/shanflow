import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import type { Principal } from '../../auth/shared/principal.js';
import { PROFILE_SELECT, ProfileService } from '../shared/profile.mapper.js';
import type { GetUserMeResponse } from './me.schema.js';

@Injectable()
export class GetMeHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  /** The caller's own profile. The id comes from the verified token, never from the request. */
  async execute(principal: Principal): Promise<GetUserMeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: PROFILE_SELECT,
    });
    // A valid token can outlive its account: removed or suspended users are treated as signed out.
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
    return { user: this.profiles.toProfile(user) };
  }
}
