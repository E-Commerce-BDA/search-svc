import { Module } from '@nestjs/common';
import { IndexerModule } from '../indexer/indexer.module.js';
import { IndexerService } from '../indexer/indexer.service.js';
import { ConsumerMetrics } from './consumer-metrics.js';
import { ConsumerStatsController } from './consumer-stats.controller.js';
import { EVENT_CONSUMER } from './event-consumer.interface.js';
import { KafkaEventConsumer } from './kafka-event-consumer.js';
import { InMemoryEventConsumer } from './in-memory-event-consumer.js';

@Module({
  imports: [IndexerModule],
  controllers: [ConsumerStatsController],
  providers: [
    ConsumerMetrics,
    KafkaEventConsumer,
    InMemoryEventConsumer,
    {
      provide: EVENT_CONSUMER,
      useFactory: (
        indexerService: IndexerService,
        kafkaConsumer: KafkaEventConsumer,
        inMemoryConsumer: InMemoryEventConsumer,
      ) => {
        if (
          process.env.NODE_ENV === 'test' ||
          process.env.USE_IN_MEMORY_EVENTS === 'true'
        ) {
          return inMemoryConsumer;
        }
        return kafkaConsumer;
      },
      inject: [IndexerService, KafkaEventConsumer, InMemoryEventConsumer],
    },
  ],
  exports: [
    EVENT_CONSUMER,
    ConsumerMetrics,
    InMemoryEventConsumer,
    KafkaEventConsumer,
  ],
})
export class EventsModule {}
