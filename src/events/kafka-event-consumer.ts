import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { dlqTopicName, isEventTopic } from '@ecom/contracts';
import { Kafka, Consumer, Producer, Partitioners } from 'kafkajs';
import {
  IndexerService,
  type HandleEventOutcome,
} from '../indexer/indexer.service.js';
import { ConsumerMetrics, recordEventOutcome } from './consumer-metrics.js';
import type { IEventConsumer } from './event-consumer.interface.js';
import { SEARCH_KAFKA_TOPICS } from './search-topics.js';

export interface KafkaConsumerOptions {
  brokers?: string[];
  clientId?: string;
  groupId?: string;
  retryDelaysMs?: number[];
  maxRetries?: number;
}

/** Why a record left the main topic. Kept as an enum-like union so the DLQ is queryable. */
type DlqReason =
  | 'invalid-json'
  | 'invalid-envelope'
  | 'invalid-payload'
  | 'transient-exhausted';

interface DlqRecord {
  reason: DlqReason;
  error: string;
  /** Present for `invalid-json`, where there is no parsed envelope to keep. */
  rawValue?: string;
  /** Present when the body parsed but was rejected or failed downstream. */
  originalPayload?: unknown;
}

@Injectable()
export class KafkaEventConsumer
  implements IEventConsumer, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KafkaEventConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly producer: Producer;
  private readonly metrics: ConsumerMetrics;
  private isRunning = false;
  private connectRetryTimer: NodeJS.Timeout | null = null;
  private readonly retryDelaysMs: number[];
  private readonly maxRetries: number;

  constructor(
    private readonly indexerService: IndexerService,
    @Optional()
    @Inject('KAFKA_CONSUMER_OPTIONS')
    options?: KafkaConsumerOptions,
    @Optional() metrics?: ConsumerMetrics,
  ) {
    this.metrics = metrics ?? new ConsumerMetrics();
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
   * Processes a single incoming Kafka message.
   *
   * Public for testing. Every branch commits the offset — a record that can
   * never succeed must not become a head-of-line block for its partition — and
   * the offset is committed only after any DLQ write has succeeded.
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
    const commit = async (): Promise<void> => {
      await this.consumer.commitOffsets([
        { topic, partition, offset: nextOffset },
      ]);
    };

    let envelope: unknown;
    try {
      envelope = JSON.parse(rawString);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Malformed JSON on ${topic} at offset ${message.offset}: ${reason}. Routing to the DLQ`,
      );
      await this.sendToDlq(topic, partition, message, {
        reason: 'invalid-json',
        error: reason,
        rawValue: rawString,
      });
      this.metrics.record('invalid');
      await commit();
      return;
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        const outcome = await this.indexerService.handleEvent(envelope);

        // Side effects first, counters second: a DLQ write that fails leaves
        // the record un-counted and the retry ladder takes over.
        if (outcome.kind === 'invalid') {
          await this.sendToDlq(topic, partition, message, {
            reason:
              outcome.stage === 'envelope'
                ? 'invalid-envelope'
                : 'invalid-payload',
            error: outcome.error,
            originalPayload: envelope,
          });
        }

        recordEventOutcome(this.metrics, outcome);
        this.logOutcome(topic, message.offset, outcome);
        await commit();
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
          this.logger.error(
            `Exhausted retries on ${topic} offset ${message.offset}. Routing to the DLQ`,
            err instanceof Error ? err.stack : String(err),
          );

          // If DLQ publish fails, error bubbles up and offset is NOT committed
          await this.sendToDlq(topic, partition, message, {
            reason: 'transient-exhausted',
            error: err instanceof Error ? err.message : String(err),
            originalPayload: envelope,
          });

          // Offset committed ONLY after successful DLQ publish
          await commit();
          return;
        }
      }
    }
  }

  /**
   * A DLQ name comes from the registry when the topic is registered there, so
   * the producer of the twin topic and this consumer cannot disagree.
   */
  private dlqTopicFor(topic: string): string {
    return isEventTopic(topic) ? dlqTopicName(topic) : `${topic}.dlq`;
  }

  private async sendToDlq(
    topic: string,
    partition: number,
    message: { key?: Buffer | string | null; offset: string },
    record: DlqRecord,
  ): Promise<void> {
    await this.producer.send({
      topic: this.dlqTopicFor(topic),
      messages: [
        {
          key: message.key ? message.key.toString() : null,
          value: JSON.stringify({
            source: { topic, partition, offset: message.offset },
            failedAt: new Date().toISOString(),
            ...record,
          }),
        },
      ],
    });

    this.metrics.record('dlq');
  }

  private logOutcome(
    topic: string,
    offset: string,
    outcome: HandleEventOutcome,
  ): void {
    switch (outcome.kind) {
      case 'indexed':
        return;
      case 'duplicate':
        this.logger.debug(
          `Event ${outcome.eventId} on ${topic} offset ${offset} was already applied; skipped`,
        );
        return;
      case 'ignored':
        this.logger.warn(
          `Ignored ${outcome.type ?? 'event'} on ${topic} offset ${offset} (${outcome.reason})`,
        );
        return;
      case 'invalid':
        // Already routed to the DLQ by the caller.
        return;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
