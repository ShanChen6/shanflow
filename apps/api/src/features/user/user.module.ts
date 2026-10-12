import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GetMeController } from './me/me.controller.js';
import { GetMeHandler } from './me/me.handler.js';

/** The signed-in user's own profile and settings. Authentication itself lives in AuthModule. */
@Module({
  // AuthModule exports JwtAuthGuard and SensitiveSessionGuard for feature modules.
  imports: [PrismaModule, AuthModule],
  controllers: [GetMeController],
  providers: [GetMeHandler],
})
export class UserModule {}
