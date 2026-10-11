import { Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { validateEnvironment, type RuntimeEnvironment } from './env.schema.js';

export const appConfig = registerAs('app', (): RuntimeEnvironment => {
  // Same path for src/config and dist/config; shell environment wins.
  config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
  return validateEnvironment(process.env);
});

export type AppConfiguration = { app: RuntimeEnvironment };

@Module({
  imports: [ConfigModule.forFeature(appConfig)],
  exports: [ConfigModule],
})
export class AppConfigModule {}
