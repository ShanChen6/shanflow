import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from './config/app.config.js';
import type { AuthEnvironment } from './config/auth-env.schema.js';

async function bootstrap() {
  let app: NestExpressApplication | undefined;
  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, { abortOnError: false, bodyParser: false });
    app.enableShutdownHooks();
    const config = app.get(ConfigService<{ auth: AuthEnvironment }, true>);
    const { WEB_ORIGIN } = config.get('auth', { infer: true });
    app.use(helmet());
    // Credentials are required for the refresh cookie; only the configured web origin is allowed.
    app.enableCors({
      origin: WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 600,
    });
    app.useBodyParser('json', { limit: '16kb' });
    const configuration = app.get(ConfigService<AppConfiguration, true>).get('app', { infer: true });
    await app.listen(configuration.PORT);
  } catch {
    if (app) await app.close().catch(() => {});
    console.error('API startup failed; check runtime configuration, PostgreSQL and the configured PORT.');
    process.exitCode = 1;
  }
}
await bootstrap();
