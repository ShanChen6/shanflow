import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../../database/prisma.module.js';
import { authConfig } from '../../config/auth.config.js';
import { ConsoleMailer, Mailer, SmtpMailer } from '../../shared/mail/mailer.js';
import {
  Argon2PasswordHasher,
  PasswordHasher,
} from '../../shared/crypto/password-hasher.js';
import { Clock, SystemClock } from '../../shared/clock.js';
import { LoginController } from './login/login.controller.js';
import { LoginHandler } from './login/login.handler.js';
import { AccessTokenService } from './shared/access-token.service.js';
import { RefreshSessionStore } from './shared/refresh-session.store.js';
import { AuthMailService } from './shared/auth-mail.service.js';
import { OneTimeTokenStore } from './shared/one-time-token.store.js';
import { SensitiveSessionGuard } from './shared/sensitive-session.guard.js';
import { LogoutController } from './logout/logout.controller.js';
import { LogoutHandler } from './logout/logout.handler.js';
import { MeController } from './me/me.controller.js';
import { MeHandler } from './me/me.handler.js';
import { JwtAuthGuard } from './shared/jwt-auth.guard.js';
import { RefreshController } from './refresh/refresh.controller.js';
import { RefreshHandler } from './refresh/refresh.handler.js';
import { CookieCsrfGuard } from './shared/cookie-csrf.guard.js';
import { ConfirmEmailHandler } from './verify-email/confirm-email.handler.js';
import { RequestVerificationHandler } from './verify-email/request-verification.handler.js';
import { VerifyEmailController } from './verify-email/verify-email.controller.js';
import { EmailVerificationService } from './shared/email-verification.service.js';
import { ForgotPasswordController } from './forgot-password/forgot-password.controller.js';
import { ForgotPasswordHandler } from './forgot-password/forgot-password.handler.js';
import { ResetPasswordController } from './reset-password/reset-password.controller.js';
import { ResetPasswordHandler } from './reset-password/reset-password.handler.js';
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
  controllers: [
    RegisterController,
    LoginController,
    MeController,
    RefreshController,
    LogoutController,
    VerifyEmailController,
    ForgotPasswordController,
    ResetPasswordController,
  ],
  // Other feature modules import AuthModule to use @UseGuards(JwtAuthGuard).
  exports: [JwtAuthGuard, SensitiveSessionGuard, AccessTokenService],
  providers: [
    RegisterHandler,
    LoginHandler,
    MeHandler,
    RefreshHandler,
    LogoutHandler,
    RequestVerificationHandler,
    ConfirmEmailHandler,
    ForgotPasswordHandler,
    ResetPasswordHandler,
    EmailVerificationService,
    CookieCsrfGuard,
    JwtAuthGuard,
    AccessTokenService,
    RefreshSessionStore,
    OneTimeTokenStore,
    AuthMailService,
    SensitiveSessionGuard,
    {
      provide: Mailer,
      inject: [authConfig.KEY],
      useFactory: (config: ConfigType<typeof authConfig>) =>
        config.MAIL_TRANSPORT === 'smtp' && config.SMTP_URL
          ? SmtpMailer.fromUrl(config.SMTP_URL, config.MAIL_FROM)
          : new ConsoleMailer(),
    },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class AuthModule {}
