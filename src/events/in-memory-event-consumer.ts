import { Injectable, Logger } from '@nestjs/common';
import { IndexerService } from '../indexer/indexer.service.js';
import type { IEventConsumer } from './event-consumer.interface.js';

@Injectable()
export class InMemoryEventConsumer implements IEventConsumer {
  private readonly logger = new Logger(InMemoryEventConsumer.name);

  constructor(private readonly indexerService: IndexerService) {}

  async start(): Promise<void> {
    this.logger.log('InMemoryEventConsumer active');
  }

  async stop(): Promise<void> {
    this.logger.log('InMemoryEventConsumer stopped');
  }

  async publish(event: unknown): Promise<'accepted' | 'skipped' | 'ignored'> {
    return this.indexerService.handleEvent(event);
  }
}
