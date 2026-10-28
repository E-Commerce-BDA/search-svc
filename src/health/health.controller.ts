import { Controller, Get, Header } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { LivenessResponse, ReadinessResponse } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  checkLiveness(): LivenessResponse {
    return this.healthService.checkLiveness();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  checkReadiness(): Promise<ReadinessResponse> {
    return this.healthService.checkReadiness();
  }
}
