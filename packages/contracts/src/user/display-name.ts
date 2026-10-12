import { z } from 'zod';

export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * How a person's name is shown to others. Trimmed and Unicode-normalised (NFC) so equal-looking names compare
 * equal, and free of control and invisible formatting characters (zero-width joiners, right-to-left overrides…)
 * that are used to spoof or hide text.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX_LENGTH)
  .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value))
  .transform((value) => value.normalize('NFC'));
