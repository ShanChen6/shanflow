import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { userConfig } from '../../config/user.config.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { Clock, SystemClock } from '../../shared/clock.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarController } from './avatar/avatar.controller.js';
import { AvatarHandler } from './avatar/avatar.handler.js';
import { GetMeController } from './me/me.controller.js';
import { GetMeHandler } from './me/me.handler.js';
import { AvatarStorage, LocalAvatarStorage } from './shared/avatar-storage.js';
import { ProfileService } from './shared/profile.mapper.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsHandler } from './settings/settings.handler.js';
import { UpdateProfileController } from './update-profile/update-profile.controller.js';
import { UpdateProfileHandler } from './update-profile/update-profile.handler.js';

/** The signed-in user's own profile and settings. Authentication itself lives in AuthModule. */
@Module({
  // AuthModule exports JwtAuthGuard and SensitiveSessionGuard for feature modules.
  // Validates the user environment at startup (fail-fast).
  imports: [PrismaModule, AuthModule, ConfigModule.forFeature(userConfig)],
  // The avatar routes share /users with the others; the literal `me` routes are declared first so `:id` never captures them.
  controllers: [
    GetMeController,
    UpdateProfileController,
    SettingsController,
    AvatarController,
  ],
  providers: [
    GetMeHandler,
    UpdateProfileHandler,
    AvatarHandler,
    SettingsHandler,
    ProfileService,
    { provide: Clock, useClass: SystemClock },
    {
      provide: AvatarStorage,
      inject: [userConfig.KEY],
      useFactory: (config: ConfigType<typeof userConfig>) =>
        new LocalAvatarStorage(config.AVATAR_STORAGE_DIR),
    },
  ],
})
export class UserModule {}
