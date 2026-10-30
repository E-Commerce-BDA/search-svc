import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ServiceKeyGuard } from '../auth/guards/service-key.guard.js';
import {
  ConsumerMetrics,
  type ConsumerStatsSnapshot,
} from './consumer-metrics.js';

/**
 * Observability for the event pipeline: the counters are the only way to see
 * how many records were ignored, deduped, or dead-lettered without reading
 * logs. Same `search/internal` prefix and service key as the indexer routes.
 */
@Controller('search/internal')
@UseGuards(ServiceKeyGuard)
export class ConsumerStatsController {
  constructor(private readonly metrics: ConsumerMetrics) {}

  @Get('consumer-stats')
  @Header('Cache-Control', 'no-store')
  snapshot(): ConsumerStatsSnapshot {
    return this.metrics.snapshot();
  }
}
