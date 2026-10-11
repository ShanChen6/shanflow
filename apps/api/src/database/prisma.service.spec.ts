import { Test } from '@nestjs/testing';
import { PrismaModule } from './prisma.module.js';
import { PrismaService } from './prisma.service.js';
import { validateEnvironment } from '../config/env.schema.js';

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  client: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(options: unknown) { mocks.adapter(options); }
  },
}));

vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: class {
    constructor(options: unknown) { mocks.client(options); }
    $connect = mocks.connect;
    $disconnect = mocks.disconnect;
    $queryRaw = mocks.query;
  },
}));

const runtimeUrl = 'postgresql://shanflow_app@127.0.0.1:55432/shanflow?schema=public';

describe('Prisma integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PORT', '3001');
    vi.stubEnv('DATABASE_URL', runtimeUrl);
    vi.stubEnv('DIRECT_DATABASE_URL', 'postgresql://shanflow_migrator@localhost/shanflow');
    mocks.connect.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue([{ connected: 1 }]);
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it('exports an injectable singleton and connects/disconnects via Nest lifecycle', async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [{
        provide: 'consumer',
        inject: [PrismaService],
        useFactory: (service: PrismaService) => service,
      }],
    }).compile();
    try {
      expect(module.get('consumer')).toBe(module.get(PrismaService));
      await module.init();
      expect(mocks.client).toHaveBeenCalledTimes(1);
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      expect(mocks.query).toHaveBeenCalledTimes(1);
      expect(mocks.adapter).toHaveBeenCalledWith({ connectionString: runtimeUrl, connectionTimeoutMillis: 5000 });
    } finally {
      await module.close();
    }
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uses the injected runtime URL instead of process or migration credentials', () => {
    vi.stubEnv('DATABASE_URL', 'invalid-process-value');
    new PrismaService(validateEnvironment({ DATABASE_URL: runtimeUrl }));
    expect(mocks.adapter).toHaveBeenCalledWith({ connectionString: runtimeUrl, connectionTimeoutMillis: 5000 });
  });

  it('validates configuration before constructing the database adapter', async () => {
    vi.stubEnv('DATABASE_URL', 'invalid-process-value');
    await expect(Test.createTestingModule({ imports: [PrismaModule] }).compile())
      .rejects.toThrow('Invalid runtime environment');
    expect(mocks.adapter).not.toHaveBeenCalled();
  });

  it.each(['connect', 'query'] as const)('cleans up after %s failure without exposing driver errors', async (step) => {
    mocks[step].mockRejectedValue(new Error('sensitive driver connection details'));
    const service = new PrismaService(validateEnvironment({ DATABASE_URL: runtimeUrl }));
    await expect(service.onModuleInit()).rejects.toThrow(/^Runtime database connection failed; check PostgreSQL and DATABASE_URL\.$/);
    await service.onModuleDestroy();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    if (step === 'connect') expect(mocks.query).not.toHaveBeenCalled();
  });

  it('reports a sanitized startup failure even if cleanup fails', async () => {
    mocks.query.mockRejectedValue(new Error('sensitive query details'));
    mocks.disconnect.mockRejectedValue(new Error('sensitive cleanup details'));
    await expect(new PrismaService(validateEnvironment({ DATABASE_URL: runtimeUrl })).onModuleInit()).rejects.toThrow(/^Runtime database connection failed and cleanup failed\.$/);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects at most once and sanitizes shutdown failure', async () => {
    mocks.disconnect.mockRejectedValue(new Error('sensitive cleanup details'));
    const service = new PrismaService(validateEnvironment({ DATABASE_URL: runtimeUrl }));
    await expect(service.onModuleDestroy()).rejects.toThrow(/^Runtime database disconnect failed\.$/);
    await expect(service.onModuleDestroy()).rejects.toThrow(/^Runtime database disconnect failed\.$/);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
