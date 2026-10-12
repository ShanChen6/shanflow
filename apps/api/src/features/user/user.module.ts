import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GetMeController } from './me/me.controller.js';
import { GetMeHandler } from './me/me.handler.js';
import { UpdateProfileController } from './update-profile/update-profile.controller.js';
import { UpdateProfileHandler } from './update-profile/update-profile.handler.js';

/** The signed-in user's own profile and settings. Authentication itself lives in AuthModule. */
@Module({
  // AuthModule exports JwtAuthGuard and SensitiveSessionGuard for feature modules.
  imports: [PrismaModule, AuthModule],
  controllers: [GetMeController, UpdateProfileController],
  providers: [GetMeHandler, UpdateProfileHandler],
})
export class UserModule {}
