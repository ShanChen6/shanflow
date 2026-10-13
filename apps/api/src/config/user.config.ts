import { registerAs } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  validateUserEnvironment,
  type UserEnvironment,
} from './user-env.schema.js';

/** Where avatars go in development: `.data/avatars` at the repository root (Git-ignored). */
export const DEFAULT_AVATAR_DIR = fileURLToPath(
  new URL('../../../../.data/avatars', import.meta.url),
);

export type UserConfiguration = Omit<UserEnvironment, 'AVATAR_STORAGE_DIR'> & {
  AVATAR_STORAGE_DIR: string;
};

export const userConfig = registerAs('user', (): UserConfiguration => {
  // Same path for src/config and dist/config; shell environment wins.
  config({
    path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
    quiet: true,
  });
  const env = validateUserEnvironment(process.env);
  return {
    ...env,
    AVATAR_STORAGE_DIR: env.AVATAR_STORAGE_DIR ?? DEFAULT_AVATAR_DIR,
  };
});
