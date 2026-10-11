import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type ReadinessResponse =
  | { status: 'ok'; checks: { database: 'up' } }
  | { status: 'error'; checks: { database: 'down' } };

const up: ReadinessResponse = { status: 'ok', checks: { database: 'up' } };
const down: ReadinessResponse = { status: 'error', checks: { database: 'down' } };

@Injectable()
export class HealthService {
  private inFlight?: Promise<ReadinessResponse>;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  getReadiness(): Promise<ReadinessResponse> {
    if (this.inFlight) return this.inFlight;
    const operation = this.checkDatabase();
    this.inFlight = new Promise(resolve => {
      const deadline = setTimeout(() => resolve(down), 4000);
      const finish = (response: ReadinessResponse): void => {
        clearTimeout(deadline);
        this.inFlight = undefined;
        resolve(response);
      };
      // The HTTP deadline does not cancel a query. Keep inFlight until the
      // original transaction settles, including cleanup, to prevent piling up
      // more health queries after a timeout. Do not expose/log driver errors.
      void operation.then(() => finish(up), () => finish(down));
    });
    return this.inFlight;
  }

  private async checkDatabase(): Promise<void> {
    await this.prisma.$transaction(async transaction => {
      await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
      await transaction.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      await transaction.$queryRaw`SELECT 1`;
    }, { maxWait: 5000, timeout: 2500 });
  }
}
