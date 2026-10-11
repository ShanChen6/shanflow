import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const query = vi.fn();
  const transaction = vi.fn();

  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PORT', '3001');
    vi.stubEnv('DATABASE_URL', 'postgresql://shanflow_app@localhost/shanflow?schema=public');
    query.mockReset().mockResolvedValue([{ connected: 1 }]);
    transaction.mockReset().mockImplementation(async (callback: (tx: {
      $executeRaw: ReturnType<typeof vi.fn>;
      $queryRaw: typeof query;
    }) => Promise<void>) => {
      await callback({ $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: query });
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: vi.fn(), onModuleDestroy: vi.fn(), $transaction: transaction })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health/live returns 200 without accessing the database', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('/health/ready returns 200 when the database is healthy', () => {
    return request(app.getHttpServer()).get('/health/ready').expect(200)
      .expect({ status: 'ok', checks: { database: 'up' } });
  });

  it('/health/ready returns a safe 503 while liveness and GET / remain available', async () => {
    query.mockRejectedValue(new Error('postgresql://private:secret@database:5432/shanflow internal SQL stack'));
    await request(app.getHttpServer()).get('/health/ready').expect(503)
      .expect({ status: 'error', checks: { database: 'down' } });
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
    await request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
});
