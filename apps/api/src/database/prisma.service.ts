import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private connectionPromise?: Promise<void>;
  private disconnectPromise?: Promise<void>;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for the runtime database connection.');
    }
    try {
      const url = new URL(connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
          decodeURIComponent(url.username) !== 'shanflow_app' || url.pathname !== '/shanflow' ||
          (url.searchParams.get('schema') ?? 'public') !== 'public') {
        throw new Error('Unexpected runtime connection');
      }
    } catch {
      throw new Error('DATABASE_URL must use shanflow_app, database shanflow and schema public.');
    }
    super({
      adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }),
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
