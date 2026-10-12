import { oneTimeTokenSchema } from '@shanflow/contracts';

/** The token shape the API issues; anything else is known to be wrong without a request. */
export function isPlausibleToken(token: string | null | undefined): token is string {
  return oneTimeTokenSchema.safeParse(token).success;
}
