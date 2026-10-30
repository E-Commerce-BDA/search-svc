import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KafkaEventConsumer } from '../src/events/kafka-event-consumer.js';
import { ConsumerMetrics } from '../src/events/consumer-metrics.js';
import type {
  HandleEventOutcome,
  IndexerService,
} from '../src/indexer/indexer.service.js';

const INDEXED: HandleEventOutcome = {
  kind: 'indexed',
  status: 'accepted',
  eventId: '0190a8b0-0000-7000-8000-00000000e201',
};

const envelope = (type = 'product.updated') => ({
  id: '0190a8b0-0000-7000-8000-00000000e201',
  type,
  producer: 'catalog-svc',
  timestamp: '2026-10-30T10:00:00.000Z',
  payload: { productId: '0190a8b0-0000-7000-8000-000000000001' },
});

describe('KafkaEventConsumer', () => {
  let indexerService: {
    handleEvent: ReturnType<typeof vi.fn>;
  };
  let metrics: ConsumerMetrics;
  let consumer: KafkaEventConsumer;
  let mockConsumerCommit: ReturnType<typeof vi.fn>;
  let mockProducerSend: ReturnType<typeof vi.fn>;

  const sentRecord = (): Record<string, unknown> => {
    const [request] = mockProducerSend.mock.calls[0] as [
      { messages: { value: string }[] },
    ];
    const [message] = request.messages;
    return JSON.parse(message.value) as Record<string, unknown>;
  };

  beforeEach(() => {
    indexerService = {
      handleEvent: vi.fn(),
    };
    metrics = new ConsumerMetrics();

    consumer = new KafkaEventConsumer(
      indexerService as unknown as IndexerService,
      {
        brokers: ['localhost:9092'],
        maxRetries: 2,
        retryDelaysMs: [1, 2], // fast delays for unit tests
      },
      metrics,
    );

    mockConsumerCommit = vi.fn().mockResolvedValue(undefined);
    mockProducerSend = vi.fn().mockResolvedValue(undefined);

    // Mock internal kafkajs consumer and producer objects
    (
      consumer as unknown as {
        consumer: { commitOffsets: typeof mockConsumerCommit };
      }
    ).consumer = {
      commitOffsets: mockConsumerCommit,
    };
    (
      consumer as unknown as { producer: { send: typeof mockProducerSend } }
    ).producer = {
      send: mockProducerSend,
    };
  });

  it('processes a valid message, commits offset (offset + 1), and counts it', async () => {
    indexerService.handleEvent.mockResolvedValue(INDEXED);
    const value = envelope();

    await consumer.processMessage('product.updated', 0, {
      key: 'key-123',
      value: Buffer.from(JSON.stringify(value)),
      offset: '42',
    });

    expect(indexerService.handleEvent).toHaveBeenCalledWith(value);
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'product.updated', partition: 0, offset: '43' },
    ]);
    expect(mockProducerSend).not.toHaveBeenCalled();
    expect(metrics.snapshot()).toMatchObject({ accepted: 1, dlq: 0 });
  });

  it('routes malformed JSON to the topic DLQ and commits the offset', async () => {
    await consumer.processMessage('product.updated', 0, {
      key: null,
      value: Buffer.from('not-valid-json{[[['),
      offset: '10',
    });

    expect(indexerService.handleEvent).not.toHaveBeenCalled();
    expect(mockProducerSend).toHaveBeenCalledWith({
      topic: 'product.updated.dlq',
      messages: [
        expect.objectContaining({
          value: expect.stringContaining('invalid-json'),
        }),
      ],
    });

    const record = sentRecord();
    expect(record.reason).toBe('invalid-json');
    expect(record.rawValue).toBe('not-valid-json{[[[');
    expect(record.source).toEqual({
      topic: 'product.updated',
      partition: 0,
      offset: '10',
    });

    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'product.updated', partition: 0, offset: '11' },
    ]);
    expect(metrics.snapshot()).toMatchObject({ invalid: 1, dlq: 1 });
  });

  it('routes an invalid payload to the DLQ without retrying', async () => {
    indexerService.handleEvent.mockResolvedValue({
      kind: 'invalid',
      stage: 'payload',
      topic: 'product.updated',
      error: 'price: required',
    } satisfies HandleEventOutcome);

    await consumer.processMessage('product.updated', 2, {
      key: 'p-1',
      value: Buffer.from(JSON.stringify(envelope())),
      offset: '70',
    });

    // A malformed payload can never succeed, so it must not enter the ladder.
    expect(indexerService.handleEvent).toHaveBeenCalledTimes(1);
    expect(mockProducerSend).toHaveBeenCalledTimes(1);
    expect(sentRecord().reason).toBe('invalid-payload');
    expect(sentRecord().error).toBe('price: required');
    expect(sentRecord().originalPayload).toMatchObject({
      type: 'product.updated',
    });
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'product.updated', partition: 2, offset: '71' },
    ]);
    expect(metrics.snapshot()).toMatchObject({ invalid: 1, dlq: 1 });
  });

  it('labels an envelope-stage rejection as invalid-envelope', async () => {
    indexerService.handleEvent.mockResolvedValue({
      kind: 'invalid',
      stage: 'envelope',
      error: 'producer: Required',
    } satisfies HandleEventOutcome);

    await consumer.processMessage('category.updated', 0, {
      key: null,
      value: Buffer.from(JSON.stringify({ id: 'x', payload: {} })),
      offset: '5',
    });

    expect(mockProducerSend).toHaveBeenCalledTimes(1);
    expect(sentRecord().reason).toBe('invalid-envelope');
  });

  it('commits an ignored event with a counter and no DLQ write', async () => {
    indexerService.handleEvent.mockResolvedValue({
      kind: 'ignored',
      reason: 'not-subscribed',
      type: 'cms.updated',
    } satisfies HandleEventOutcome);

    await consumer.processMessage('blog.updated', 1, {
      key: null,
      value: Buffer.from(JSON.stringify(envelope('cms.updated'))),
      offset: '31',
    });

    expect(mockProducerSend).not.toHaveBeenCalled();
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'blog.updated', partition: 1, offset: '32' },
    ]);
    expect(metrics.snapshot()).toMatchObject({ ignored: 1, dlq: 0 });
  });

  it('commits a duplicate without writing to the index again', async () => {
    indexerService.handleEvent.mockResolvedValue({
      kind: 'duplicate',
      eventId: '0190a8b0-0000-7000-8000-00000000e201',
    } satisfies HandleEventOutcome);

    await consumer.processMessage('product.updated', 0, {
      key: 'p-1',
      value: Buffer.from(JSON.stringify(envelope())),
      offset: '80',
    });

    expect(mockProducerSend).not.toHaveBeenCalled();
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'product.updated', partition: 0, offset: '81' },
    ]);
    expect(metrics.snapshot()).toMatchObject({ duplicate: 1, accepted: 0 });
  });

  it('retries on failure and succeeds on subsequent attempt', async () => {
    indexerService.handleEvent
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce({ kind: 'indexed', status: 'skipped', eventId: 'e' });

    await consumer.processMessage('category.updated', 0, {
      key: 'cat-1',
      value: Buffer.from(JSON.stringify(envelope('category.updated'))),
      offset: '99',
    });

    expect(indexerService.handleEvent).toHaveBeenCalledTimes(2);
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'category.updated', partition: 0, offset: '100' },
    ]);
    expect(mockProducerSend).not.toHaveBeenCalled();
    expect(metrics.snapshot()).toMatchObject({ skipped: 1 });
  });

  it('exhausts retries, publishes to the DLQ, and commits offset', async () => {
    indexerService.handleEvent.mockRejectedValue(new Error('permanent error'));

    await consumer.processMessage('blog.updated', 1, {
      key: 'b-1',
      value: Buffer.from(JSON.stringify(envelope('blog.updated'))),
      offset: '200',
    });

    // 1 initial + 2 retries = 3 attempts
    expect(indexerService.handleEvent).toHaveBeenCalledTimes(3);

    expect(mockProducerSend).toHaveBeenCalledWith({
      topic: 'blog.updated.dlq',
      messages: [
        expect.objectContaining({
          key: 'b-1',
          value: expect.stringContaining('permanent error'),
        }),
      ],
    });
    expect(sentRecord().reason).toBe('transient-exhausted');

    // Committed offset after DLQ send
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'blog.updated', partition: 1, offset: '201' },
    ]);
    expect(metrics.snapshot()).toMatchObject({ dlq: 1 });
  });

  it('does NOT commit offset if DLQ publish fails', async () => {
    indexerService.handleEvent.mockRejectedValue(
      new Error('processing failure'),
    );
    mockProducerSend.mockRejectedValue(new Error('dlq broker unavailable'));

    await expect(
      consumer.processMessage('product.imported', 0, {
        key: 'p-1',
        value: Buffer.from(JSON.stringify(envelope('product.imported'))),
        offset: '50',
      }),
    ).rejects.toThrow('dlq broker unavailable');

    expect(mockConsumerCommit).not.toHaveBeenCalled();
  });

  it('does not commit a malformed JSON offset when the DLQ write fails', async () => {
    mockProducerSend.mockRejectedValue(new Error('dlq broker unavailable'));

    await expect(
      consumer.processMessage('product.updated', 0, {
        key: null,
        value: Buffer.from('{oops'),
        offset: '7',
      }),
    ).rejects.toThrow('dlq broker unavailable');

    expect(mockConsumerCommit).not.toHaveBeenCalled();
    // The counter follows the write, so a failed write is not counted as DLQed.
    expect(metrics.snapshot()).toMatchObject({ invalid: 0, dlq: 0 });
  });
});
