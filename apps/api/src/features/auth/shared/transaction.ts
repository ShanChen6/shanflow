import type { Prisma } from '../../../generated/prisma/client.js';

/** The client passed to an interactive transaction callback. */
export type Tx = Prisma.TransactionClient;
