import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { INestApplication } from '@nestjs/common';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

async function bootstrap() {
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule, { abortOnError: false });
    app.enableShutdownHooks();
    await app.listen(3001);
  } catch {
    if (app) await app.close().catch(() => {});
    console.error('API startup failed; check PostgreSQL, runtime DATABASE_URL and port 3001.');
    process.exitCode = 1;
  }
}
await bootstrap();
