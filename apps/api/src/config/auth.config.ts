import { registerAs } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  validateAuthEnvironment,
  type AuthEnvironment,
} from './auth-env.schema.js';

export const authConfig = registerAs('auth', (): AuthEnvironment => {
  // Same path for src/config and dist/config; shell environment wins.
  config({
    path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
    quiet: true,
  });
  return validateAuthEnvironment(process.env);
});
