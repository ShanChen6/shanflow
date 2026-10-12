import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../../database/prisma.module.js';
import { authConfig } from '../../config/auth.config.js';
import { Argon2PasswordHasher, PasswordHasher } from '../../shared/crypto/password-hasher.js';
import { Clock, SystemClock } from '../../shared/clock.js';
import { RegisterController } from './register/register.controller.js';
import { RegisterHandler } from './register/register.handler.js';

@Module({
  imports: [
    PrismaModule,
    // Validates the auth environment at startup (fail-fast).
    ConfigModule.forFeature(authConfig),
    // Generous fallback; each route sets its own stricter limit with @Throttle.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] }),
  ],
  controllers: [RegisterController],
  providers: [
    RegisterHandler,
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class AuthModule {}
