import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../../database/prisma.module.js';
import { authConfig } from '../../config/auth.config.js';
import {
  Argon2PasswordHasher,
  PasswordHasher,
} from '../../shared/crypto/password-hasher.js';
import { Clock, SystemClock } from '../../shared/clock.js';
import { LoginController } from './login/login.controller.js';
import { LoginHandler } from './login/login.handler.js';
import { AccessTokenService } from './shared/access-token.service.js';
import { RefreshSessionStore } from './shared/refresh-session.store.js';
import { MeController } from './me/me.controller.js';
import { MeHandler } from './me/me.handler.js';
import { JwtAuthGuard } from './shared/jwt-auth.guard.js';
import { RegisterController } from './register/register.controller.js';
import { RegisterHandler } from './register/register.handler.js';

/** Throttle key for login: client IP plus the canonical email from the body. */
function loginEmailTracker(request: Record<string, unknown>): string {
  const body = request.body as { email?: unknown } | undefined;
  const email =
    typeof body?.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, 254)
      : '';
  return `${String(request.ip)}|${email}`;
}

@Module({
  imports: [
    PrismaModule,
    // Validates the auth environment at startup (fail-fast).
    ConfigModule.forFeature(authConfig),
    // Generous fallback; each route sets its own stricter limit with @Throttle.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 60 },
        // Per client IP + target account, so one IP cannot lock a victim out from everywhere.
        // Routes that should not use it must @SkipThrottle({ 'login-email': true }).
        {
          name: 'login-email',
          ttl: 900_000,
          limit: 10,
          getTracker: loginEmailTracker,
        },
      ],
    }),
  ],
  controllers: [RegisterController, LoginController, MeController],
  // Other feature modules import AuthModule to use @UseGuards(JwtAuthGuard).
  exports: [JwtAuthGuard, AccessTokenService],
  providers: [
    RegisterHandler,
    LoginHandler,
    MeHandler,
    JwtAuthGuard,
    AccessTokenService,
    RefreshSessionStore,
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class AuthModule {}
