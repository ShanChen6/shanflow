import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from './config/app.config.js';

async function bootstrap() {
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule, { abortOnError: false });
    app.enableShutdownHooks();
    const configuration = app.get(ConfigService<AppConfiguration, true>).get('app', { infer: true });
    await app.listen(configuration.PORT);
  } catch {
    if (app) await app.close().catch(() => {});
    console.error('API startup failed; check runtime configuration, PostgreSQL and the configured PORT.');
    process.exitCode = 1;
  }
}
await bootstrap();
