import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import type { SearchDocument } from '@ecom/contracts';
import { IndexerService } from '../src/indexer/indexer.service.js';
import type { IndexerRepository } from '../src/indexer/indexer.repository.js';

const PRODUCT_EVENT = {
  id: '0190a8b0-0000-7000-8000-00000000e101',
  type: 'product.updated',
  producer: 'catalog-svc',
  timestamp: '2026-10-30T10:00:00.000Z',
  payload: {
    productId: '0190a8b0-0000-7000-8000-000000000001',
    name: 'Velocity Road Runner',
    slug: 'velocity-road-runner',
    price: 149.99,
    status: 'active',
    updatedAt: '2026-10-30T10:00:00.000Z',
  },
};

describe('IndexerService', () => {
  let repository: {
    upsert: ReturnType<typeof vi.fn>;
    withTransaction: ReturnType<typeof vi.fn>;
    markProcessed: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
  };
  let service: IndexerService;
  const client = {} as PoolClient;

  beforeEach(() => {
    repository = {
      upsert: vi.fn(),
      // A transaction mock that simply runs the callback on a fake client.
      withTransaction: vi.fn(
        async (fn: (c: PoolClient) => Promise<unknown>) => fn(client),
      ),
      markProcessed: vi.fn().mockResolvedValue(true),
      stats: vi.fn(),
    };
    service = new IndexerService(repository as unknown as IndexerRepository);
  });

  describe('handleEvent', () => {
    it('ignores an unregistered topic without opening a transaction', async () => {
      const result = await service.handleEvent({
        ...PRODUCT_EVENT,
        id: '0190a8b0-0000-7000-8000-00000000e102',
        type: 'order.placed',
      });

      expect(result).toEqual({
        kind: 'ignored',
        reason: 'unknown-topic',
        type: 'order.placed',
      });
      expect(repository.withTransaction).not.toHaveBeenCalled();
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('returns invalid with the stage when the payload drifts', async () => {
      const result = await service.handleEvent({
        ...PRODUCT_EVENT,
        id: '0190a8b0-0000-7000-8000-00000000e103',
        payload: { productId: '0190a8b0-0000-7000-8000-000000000001' },
      });

      expect(result.kind).toBe('invalid');
      expect(repository.withTransaction).not.toHaveBeenCalled();
    });

    it('claims the event id and upserts on the same client', async () => {
      repository.upsert.mockResolvedValue({ status: 'accepted' });

      const result = await service.handleEvent(PRODUCT_EVENT);

      expect(repository.markProcessed).toHaveBeenCalledWith(
        client,
        '0190a8b0-0000-7000-8000-00000000e101',
        'product.updated',
      );
      expect(repository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '0190a8b0-0000-7000-8000-000000000001',
          documentType: 'product',
          title: 'Velocity Road Runner',
        }),
        client,
      );
      expect(result).toEqual({
        kind: 'indexed',
        status: 'accepted',
        eventId: '0190a8b0-0000-7000-8000-00000000e101',
      });
    });

    it('reports duplicate and skips the upsert when the id was already claimed', async () => {
      repository.markProcessed.mockResolvedValue(false);

      const result = await service.handleEvent(PRODUCT_EVENT);

      expect(result).toEqual({
        kind: 'duplicate',
        eventId: '0190a8b0-0000-7000-8000-00000000e101',
      });
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('propagates a database failure so the consumer can retry', async () => {
      repository.upsert.mockRejectedValue(new Error('deadlock detected'));

      await expect(service.handleEvent(PRODUCT_EVENT)).rejects.toThrow(
        'deadlock detected',
      );
    });
  });

  describe('ingestMany', () => {
    const docA: SearchDocument = {
      id: '0190a8b0-0000-7000-8000-000000000001',
      documentType: 'product',
      title: 'Shoe A',
      slug: 'shoe-a',
      content: 'Shoe A content',
      status: 'active',
      sourceUpdatedAt: '2026-10-28T10:00:00.000Z',
    };
    const docB: SearchDocument = {
      id: '0190a8b0-0000-7000-8000-000000000002',
      documentType: 'product',
      title: 'Shoe B',
      slug: 'shoe-b',
      content: 'Shoe B content',
      status: 'active',
      sourceUpdatedAt: '2026-10-28T09:00:00.000Z',
    };
    const docC: SearchDocument = {
      id: '0190a8b0-0000-7000-8000-000000000003',
      documentType: 'product',
      title: 'Shoe C',
      slug: 'shoe-c',
      content: 'Shoe C content',
      status: 'active',
      sourceUpdatedAt: '2026-10-28T08:00:00.000Z',
    };

    it('aggregates accepted, skipped, and rejected counts properly', async () => {
      repository.upsert
        .mockResolvedValueOnce({ status: 'accepted' })
        .mockResolvedValueOnce({ status: 'skipped' })
        .mockRejectedValueOnce({
          code: '23514',
          message: 'check violation',
        });

      const response = await service.ingestMany([docA, docB, docC]);

      expect(response).toEqual({
        accepted: 1,
        skipped: 1,
        rejected: 1,
      });
      // The HTTP path writes without a client and without claiming an id.
      expect(repository.upsert).toHaveBeenCalledWith(docA);
    });

    it('re-throws critical database connection errors', async () => {
      repository.upsert.mockRejectedValueOnce(
        new Error('connection timeout / network broken'),
      );

      await expect(service.ingestMany([docA])).rejects.toThrow(
        'connection timeout / network broken',
      );
    });
  });

  describe('stats', () => {
    it('forwards stats query to repository', async () => {
      const mockStats = {
        documents: 10,
        active: 8,
        byType: { product: 6, category: 2, blog: 2 },
        lastSyncedAt: '2026-10-28T12:00:00.000Z',
      };
      repository.stats.mockResolvedValue(mockStats);

      const stats = await service.stats();
      expect(stats).toEqual(mockStats);
    });
  });
});
