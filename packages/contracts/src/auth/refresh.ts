import { loginResponseSchema } from './login.js';

/** Same shape as login: a new access token and the profile. The new refresh token is set as a cookie. */
export const refreshResponseSchema = loginResponseSchema;

export type RefreshResponse = ReturnType<typeof refreshResponseSchema.parse>;
