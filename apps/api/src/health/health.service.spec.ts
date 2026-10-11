import { HealthService } from './health.service.js';
import { PrismaService } from '../database/prisma.service.js';

describe('HealthService', () => {
  const executeRaw = vi.fn();
  const queryRaw = vi.fn();
  const transaction = vi.fn();
  let service: HealthService;

  beforeEach(() => {
    vi.resetAllMocks();
    executeRaw.mockResolvedValue(0);
    queryRaw.mockResolvedValue([{ connected: 1 }]);
    transaction.mockImplementation(async (callback: (tx: { $executeRaw: typeof executeRaw; $queryRaw: typeof queryRaw }) => Promise<void>) => {
      await callback({ $executeRaw: executeRaw, $queryRaw: queryRaw });
    });
    service = new HealthService({ $transaction: transaction } as unknown as PrismaService);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('uses the injected Prisma transaction with read-only SQL and local server timeout', async () => {
    await expect(service.getReadiness()).resolves.toEqual({ status: 'ok', checks: { database: 'up' } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 2500 });
    expect(executeRaw.mock.calls.map(call => Array.from(call[0] as TemplateStringsArray).join('')))
      .toEqual(['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '1500ms'"]);
    expect(queryRaw).toHaveBeenCalledWith(expect.arrayContaining(['SELECT 1']));
  });

  it('maps connection/query/transaction failure to a stable response without leaking details', async () => {
    queryRaw.mockRejectedValue(new Error('postgresql://private:secret@database:5432/private SELECT 1 stack trace'));
    await expect(service.getReadiness()).resolves.toEqual({ status: 'error', checks: { database: 'down' } });
  });

  it('treats a server statement timeout as down', async () => {
    queryRaw.mockRejectedValue(new Error('canceling statement due to statement timeout'));
    await expect(service.getReadiness()).resolves.toEqual({ status: 'error', checks: { database: 'down' } });
  });

  it('shares concurrent checks rather than constructing clients or filling the pool', async () => {
    const responses = await Promise.all(Array.from({ length: 25 }, () => service.getReadiness()));
    expect(responses.every(response => response.status === 'ok')).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('bounds HTTP wait, retains a stuck operation, handles late failure and can recover', async () => {
    vi.useFakeTimers();
    let rejectOperation!: (error: Error) => void;
    transaction.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOperation = reject; }));
    const first = service.getReadiness();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(first).resolves.toEqual({ status: 'error', checks: { database: 'down' } });
    expect(service.getReadiness()).toBe(first);
    expect(transaction).toHaveBeenCalledTimes(1);
    rejectOperation(new Error('late sensitive error'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(service.getReadiness()).resolves.toEqual({ status: 'ok', checks: { database: 'up' } });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
