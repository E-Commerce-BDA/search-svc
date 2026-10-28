import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Kafka, Consumer, Producer, Partitioners } from 'kafkajs';
import { IndexerService } from '../indexer/indexer.service.js';
import type { IEventConsumer } from './event-consumer.interface.js';

export const SEARCH_KAFKA_TOPICS = [
  'product.updated',
  'category.updated',
  'blog.updated',
  'product.imported',
];

export interface KafkaConsumerOptions {
  brokers?: string[];
  clientId?: string;
  groupId?: string;
  retryDelaysMs?: number[];
  maxRetries?: number;
}

@Injectable()
export class KafkaEventConsumer
  implements IEventConsumer, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KafkaEventConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly producer: Producer;
  private isRunning = false;
  private connectRetryTimer: NodeJS.Timeout | null = null;
  private readonly retryDelaysMs: number[];
  private readonly maxRetries: number;

  constructor(
    private readonly indexerService: IndexerService,
    @Optional()
    @Inject('KAFKA_CONSUMER_OPTIONS')
    options?: KafkaConsumerOptions,
  ) {
    const rawBrokers =
      options?.brokers ??
      (process.env.KAFKA_BROKERS ?? 'localhost:9092')
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);

    this.retryDelaysMs = options?.retryDelaysMs ?? [
      1000, 2000, 4000, 8000, 16000,
    ];
    this.maxRetries = options?.maxRetries ?? 5;

    this.kafka = new Kafka({
      clientId: options?.clientId ?? 'search-svc',
      brokers: rawBrokers,
      retry: {
        initialRetryTime: 300,
        retries: 3,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: options?.groupId ?? 'search-svc',
    });

    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    // Attempt connection in the background so app boots even if Kafka is temporarily unavailable
    void this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    await this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      await this.consumer.connect();
      await this.producer.connect();

      for (const topic of SEARCH_KAFKA_TOPICS) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }

      await this.consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          await this.processMessage(topic, partition, message);
        },
      });

      this.isRunning = true;
      this.logger.log('KafkaEventConsumer connected and subscribed to topics');
    } catch (error) {
      this.logger.warn(
        `KafkaEventConsumer failed to connect to broker: ${error instanceof Error ? error.message : String(error)}. Retrying in 5 seconds...`,
      );
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.connectRetryTimer) {
      clearTimeout(this.connectRetryTimer);
    }
    this.connectRetryTimer = setTimeout(() => {
      void this.connectWithRetry();
    }, 5000);
  }

  async stop(): Promise<void> {
    if (this.connectRetryTimer) {
      clearTimeout(this.connectRetryTimer);
      this.connectRetryTimer = null;
    }

    this.isRunning = false;

    try {
      await this.consumer.disconnect();
    } catch {
      // Ignore disconnect error during shutdown
    }

    try {
      await this.producer.disconnect();
    } catch {
      // Ignore disconnect error during shutdown
    }
  }

  /**
   * Processes a single incoming Kafka message with retry and DLQ routing.
   * Public for testing.
   */
  async processMessage(
    topic: string,
    partition: number,
    message: {
      key?: Buffer | string | null;
      value: Buffer | string | null;
      offset: string;
    },
  ): Promise<void> {
    const rawString = message.value?.toString() ?? '';
    const nextOffset = (BigInt(message.offset) + 1n).toString();

    let envelope: unknown;
    try {
      envelope = JSON.parse(rawString);
    } catch {
      this.logger.warn(
        `Malformed non-JSON message received on ${topic} at offset ${message.offset}; committing offset to prevent head-of-line blocking`,
      );
      await this.consumer.commitOffsets([
        { topic, partition, offset: nextOffset },
      ]);
      return;
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        await this.indexerService.handleEvent(envelope);
        await this.consumer.commitOffsets([
          { topic, partition, offset: nextOffset },
        ]);
        return;
      } catch (err) {
        if (attempt < this.maxRetries) {
          const delay =
            this.retryDelaysMs[attempt] ??
            this.retryDelaysMs[this.retryDelaysMs.length - 1];
          this.logger.warn(
            `Failed processing message on ${topic} (attempt ${attempt + 1}/${this.maxRetries}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay}ms...`,
          );
          await this.sleep(delay);
          attempt++;
        } else {
          // Exhausted retries -> publish to DLQ
          const dlqTopic = `${topic}.dlq`;
          this.logger.error(
            `Exhausted retries on ${topic} offset ${message.offset}. Routing to ${dlqTopic}`,
            err instanceof Error ? err.stack : String(err),
          );

          // If DLQ publish fails, error bubbles up and offset is NOT committed
          await this.producer.send({
            topic: dlqTopic,
            messages: [
              {
                key: message.key ? message.key.toString() : null,
                value: JSON.stringify({
                  originalPayload: envelope,
                  failedAt: new Date().toISOString(),
                  error: err instanceof Error ? err.message : String(err),
                }),
              },
            ],
          });

          // Offset committed ONLY after successful DLQ publish
          await this.consumer.commitOffsets([
            { topic, partition, offset: nextOffset },
          ]);
          return;
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
