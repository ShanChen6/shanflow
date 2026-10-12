import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
// Matches the API hasher's upper bound; protects against oversized-input abuse.
export const PASSWORD_MAX_LENGTH = 128;

/** Policy for choosing a new password. Never trimmed or otherwise altered; no composition rules. */
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** An existing password being presented: only bounded, since the signup policy must not be revealed. */
export const presentedPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
