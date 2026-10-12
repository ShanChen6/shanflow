import type { Request } from 'express';

/** The authenticated caller, as proven by a valid access token. It carries identity only, never permissions. */
export interface Principal {
  userId: string;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { principal?: Principal };
