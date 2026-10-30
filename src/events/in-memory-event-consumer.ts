import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IndexerService,
  type HandleEventOutcome,
} from '../indexer/indexer.service.js';
import { ConsumerMetrics, recordEventOutcome } from './consumer-metrics.js';
import type { IEventConsumer } from './event-consumer.interface.js';

@Injectable()
export class InMemoryEventConsumer implements IEventConsumer {
  private readonly logger = new Logger(InMemoryEventConsumer.name);
  private readonly metrics: ConsumerMetrics;

  constructor(
    private readonly indexerService: IndexerService,
    @Optional() metrics?: ConsumerMetrics,
  ) {
    this.metrics = metrics ?? new ConsumerMetrics();
  }

  async start(): Promise<void> {
    this.logger.log('InMemoryEventConsumer active');
  }

  async stop(): Promise<void> {
    this.logger.log('InMemoryEventConsumer stopped');
  }

  async publish(event: unknown): Promise<HandleEventOutcome> {
    const outcome = await this.indexerService.handleEvent(event);
    recordEventOutcome(this.metrics, outcome);
    return outcome;
  }
}
