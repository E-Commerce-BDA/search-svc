import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SearchDocument } from '@ecom/contracts';
import { IndexerService } from '../src/indexer/indexer.service.js';
import type { IndexerRepository } from '../src/indexer/indexer.repository.js';

describe('IndexerService', () => {
  let repository: {
    upsert: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
  };
  let service: IndexerService;

  beforeEach(() => {
    repository = {
      upsert: vi.fn(),
      stats: vi.fn(),
    };
    service = new IndexerService(repository as unknown as IndexerRepository);
  });

  describe('handleEvent', () => {
    it('returns ignored for unknown topics or malformed envelopes', async () => {
      const result = await service.handleEvent({
        topic: 'unknown.topic',
        payload: {},
      });
      expect(result).toBe('ignored');
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('maps valid event and calls repository upsert', async () => {
      repository.upsert.mockResolvedValue({ status: 'accepted' });

      const result = await service.handleEvent({
        topic: 'category.updated',
        payload: {
          categoryId: '0190a8b0-0000-7000-8000-000000000101',
          name: 'Road Running',
          slug: 'road-running',
          isActive: true,
        },
      });

      expect(result).toBe('accepted');
      expect(repository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '0190a8b0-0000-7000-8000-000000000101',
          documentType: 'category',
          title: 'Road Running',
        }),
      );
    });

    it('returns skipped when upsert stale guard triggers', async () => {
      repository.upsert.mockResolvedValue({ status: 'skipped' });

      const result = await service.handleEvent({
        topic: 'category.updated',
        payload: {
          categoryId: '0190a8b0-0000-7000-8000-000000000101',
          name: 'Old Category',
          slug: 'old-category',
          isActive: true,
        },
      });

      expect(result).toBe('skipped');
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

