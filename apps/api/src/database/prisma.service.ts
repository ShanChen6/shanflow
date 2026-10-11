import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../config/app.config.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private connectionPromise?: Promise<void>;
  private disconnectPromise?: Promise<void>;

  constructor(@Inject(appConfig.KEY) configuration: ConfigType<typeof appConfig>) {
    super({
      adapter: new PrismaPg({ connectionString: configuration.DATABASE_URL, connectionTimeoutMillis: 5000 }),
      log: [],
    });
  }

  onModuleInit(): Promise<void> {
    return this.connectionPromise ??= this.connectRuntime();
  }

  private async connectRuntime(): Promise<void> {
    try {
      await this.$connect();
      // The adapter creates a lazy pool: a query verifies actual connectivity.
      await this.$queryRaw`SELECT 1`;
    } catch {
      try {
        await this.disconnectOnce();
      } catch {
        throw new Error('Runtime database connection failed and cleanup failed.');
      }
      // Do not attach the driver error: it can contain connection details.
      throw new Error('Runtime database connection failed; check PostgreSQL and DATABASE_URL.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.disconnectOnce();
    } catch {
      throw new Error('Runtime database disconnect failed.');
    }
  }

  private disconnectOnce(): Promise<void> {
    return this.disconnectPromise ??= this.$disconnect();
  }
}
