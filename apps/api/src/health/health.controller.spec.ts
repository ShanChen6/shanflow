import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  const readiness = vi.fn();
  let controller: HealthController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new HealthController({ getReadiness: readiness } as unknown as HealthService);
  });

  it('returns live without invoking readiness or database checks', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(readiness).not.toHaveBeenCalled();
  });

  it('returns ready when the database is up', async () => {
    readiness.mockResolvedValue({ status: 'ok', checks: { database: 'up' } });
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('throws HTTP 503 with exactly the safe down response', async () => {
    readiness.mockResolvedValue({ status: 'error', checks: { database: 'down' } });
    try {
      await controller.ready();
      expect.fail('Expected HTTP 503');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      if (!(error instanceof ServiceUnavailableException)) throw error;
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toEqual({ status: 'error', checks: { database: 'down' } });
    }
  });
});
