import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KafkaEventConsumer } from '../src/events/kafka-event-consumer.js';
import type { IndexerService } from '../src/indexer/indexer.service.js';

describe('KafkaEventConsumer', () => {
  let indexerService: {
    handleEvent: ReturnType<typeof vi.fn>;
  };
  let consumer: KafkaEventConsumer;
  let mockConsumerCommit: ReturnType<typeof vi.fn>;
  let mockProducerSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    indexerService = {
      handleEvent: vi.fn(),
    };

    consumer = new KafkaEventConsumer(
      indexerService as unknown as IndexerService,
      {
        brokers: ['localhost:9092'],
        maxRetries: 2,
        retryDelaysMs: [1, 2], // fast delays for unit tests
      },
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

  it('processes valid message and commits offset (offset + 1)', async () => {
    indexerService.handleEvent.mockResolvedValue('accepted');

    const envelope = {
      topic: 'product.updated',
      payload: { productId: '123' },
    };

    await consumer.processMessage('product.updated', 0, {
      key: 'key-123',
      value: Buffer.from(JSON.stringify(envelope)),
      offset: '42',
    });

    expect(indexerService.handleEvent).toHaveBeenCalledWith(envelope);
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'product.updated', partition: 0, offset: '43' },
    ]);
    expect(mockProducerSend).not.toHaveBeenCalled();
  });

  it('commits offset and ignores malformed non-JSON messages to avoid head-of-line blocking', async () => {
    await consumer.processMessage('product.updated', 0, {
      key: null,
      value: Buffer.from('not-valid-json{[[['),
      offset: '10',
    });

    expect(indexerService.handleEvent).not.toHaveBeenCalled();
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'product.updated', partition: 0, offset: '11' },
    ]);
  });

  it('retries on failure and succeeds on subsequent attempt', async () => {
    indexerService.handleEvent
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce('accepted');

    const envelope = { topic: 'category.updated', payload: {} };

    await consumer.processMessage('category.updated', 0, {
      key: 'cat-1',
      value: Buffer.from(JSON.stringify(envelope)),
      offset: '99',
    });

    expect(indexerService.handleEvent).toHaveBeenCalledTimes(2);
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'category.updated', partition: 0, offset: '100' },
    ]);
    expect(mockProducerSend).not.toHaveBeenCalled();
  });

  it('exhausts retries, publishes to DLQ, and commits offset', async () => {
    indexerService.handleEvent.mockRejectedValue(new Error('permanent error'));

    const envelope = { topic: 'blog.updated', payload: { blogId: 'b-1' } };

    await consumer.processMessage('blog.updated', 1, {
      key: 'b-1',
      value: Buffer.from(JSON.stringify(envelope)),
      offset: '200',
    });

    // 1 initial + 2 retries = 3 attempts
    expect(indexerService.handleEvent).toHaveBeenCalledTimes(3);

    // Published to DLQ topic
    expect(mockProducerSend).toHaveBeenCalledWith({
      topic: 'blog.updated.dlq',
      messages: [
        expect.objectContaining({
          key: 'b-1',
          value: expect.stringContaining('permanent error'),
        }),
      ],
    });

    // Committed offset after DLQ send
    expect(mockConsumerCommit).toHaveBeenCalledWith([
      { topic: 'blog.updated', partition: 1, offset: '201' },
    ]);
  });

  it('does NOT commit offset if DLQ publish fails', async () => {
    indexerService.handleEvent.mockRejectedValue(
      new Error('processing failure'),
    );
    mockProducerSend.mockRejectedValue(new Error('dlq broker unavailable'));

    const envelope = { topic: 'product.imported', payload: {} };

    await expect(
      consumer.processMessage('product.imported', 0, {
        key: 'p-1',
        value: Buffer.from(JSON.stringify(envelope)),
        offset: '50',
      }),
    ).rejects.toThrow('dlq broker unavailable');

    expect(mockConsumerCommit).not.toHaveBeenCalled();
  });
});
