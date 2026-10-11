import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, type ReadinessResponse } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    const response = await this.health.getReadiness();
    if (response.status === 'error') throw new ServiceUnavailableException(response);
    return response;
  }
}
