import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchSuggestResponse } from '@ecom/contracts';
import { SearchService } from '../src/search/search.service.js';
import type { SearchRepository } from '../src/search/search.repository.js';
import type { RedisService } from '../src/redis/redis.service.js';
import type {
  SearchDocumentRow,
  SuggestRow,
  ValidatedSearchQuery,
} from '../src/search/search.types.js';
import { decodeCursor } from '../src/search/cursor.codec.js';

describe('SearchService', () => {
  let service: SearchService;
  let repository: {
    suggest: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
  let redisService: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  const sampleSuggestRows: SuggestRow[] = [
    {
      id: 'cat-1',
      document_type: 'category',
      title: 'Road Running',
      slug: 'road-running',
      image_url: 'https://img.com/cat.jpg',
      price: null,
      effective_price: null,
      popularity: 80,
    },
    {
      id: 'prod-1',
      document_type: 'product',
      title: 'Velocity Road Runner',
      slug: 'velocity-road-runner',
      image_url: 'https://img.com/prod.jpg',
      price: '149.99',
      effective_price: '129.99',
      popularity: 95,
    },
    {
      id: 'prod-2',
      document_type: 'product',
      title: 'Trail Runner Basic',
      slug: 'trail-runner-basic',
      image_url: null,
      price: null,
      effective_price: null,
      popularity: 40,
    },
    {
      id: 'blog-1',
      document_type: 'blog',
      title: 'How to Choose Your Road Running Shoe',
      slug: 'how-to-choose',
      image_url: 'https://img.com/blog.jpg',
      price: null,
      effective_price: null,
      popularity: 82,
    },
  ];

  beforeEach(() => {
    repository = {
      suggest: vi.fn().mockResolvedValue(sampleSuggestRows),
      search: vi.fn().mockResolvedValue({ rows: [], totalHits: 0 }),
    };
    redisService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };

    service = new SearchService(
      repository as unknown as SearchRepository,
      redisService as unknown as RedisService,
    );
  });

  describe('suggest()', () => {
    it('queries repository, groups results, and writes to Redis on cache miss (limit=5)', async () => {
      const result = await service.suggest('sho', 5);

      expect(redisService.get).toHaveBeenCalledWith('search:suggest:sho');
      expect(repository.suggest).toHaveBeenCalledWith('sho:*', 5);

      expect(result.query).toBe('sho');
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0]).toEqual({
        id: 'cat-1',
        name: 'Road Running',
        slug: 'road-running',
        image: 'https://img.com/cat.jpg',
      });

      expect(result.products).toHaveLength(2);
      expect(result.products[0]).toEqual({
        id: 'prod-1',
        slug: 'velocity-road-runner',
        name: 'Velocity Road Runner',
        image: 'https://img.com/prod.jpg',
        price: 149.99,
        effectivePrice: 129.99,
      });
      expect(result.products[1]).toEqual({
        id: 'prod-2',
        slug: 'trail-runner-basic',
        name: 'Trail Runner Basic',
        image: undefined,
        price: null,
        effectivePrice: null,
      });

      expect(result.blogs).toHaveLength(1);
      expect(result.blogs[0]).toEqual({
        id: 'blog-1',
        slug: 'how-to-choose',
        title: 'How to Choose Your Road Running Shoe',
        cover: 'https://img.com/blog.jpg',
      });

      expect(redisService.set).toHaveBeenCalledWith(
        'search:suggest:sho',
        JSON.stringify(result),
        600,
      );
    });

    it('returns cached response directly on cache hit without querying DB repository', async () => {
      const cachedResponse: SearchSuggestResponse = {
        query: 'sho',
        categories: [{ id: 'cat-c', name: 'Cached Cat', slug: 'cached-cat' }],
        products: [],
        blogs: [],
      };
      redisService.get.mockResolvedValue(JSON.stringify(cachedResponse));

      const result = await service.suggest('sho', 5);

      expect(redisService.get).toHaveBeenCalledWith('search:suggest:sho');
      expect(repository.suggest).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
      expect(result).toEqual(cachedResponse);
    });

    it('deletes corrupt JSON from Redis and falls back to database', async () => {
      redisService.get.mockResolvedValue('not-valid-json{{{');

      const result = await service.suggest('sho', 5);

      expect(redisService.del).toHaveBeenCalledWith('search:suggest:sho');
      expect(repository.suggest).toHaveBeenCalledWith('sho:*', 5);
      expect(result.query).toBe('sho');
      expect(result.categories).toHaveLength(1);
    });

    it('deletes malformed schema JSON from Redis and falls back to database', async () => {
      redisService.get.mockResolvedValue(JSON.stringify({ unexpected: 'shape' }));

      const result = await service.suggest('sho', 5);

      expect(redisService.del).toHaveBeenCalledWith('search:suggest:sho');
      expect(repository.suggest).toHaveBeenCalledWith('sho:*', 5);
      expect(result.query).toBe('sho');
    });

    it('gracefully degrades to DB when Redis throws an error', async () => {
      redisService.get.mockRejectedValue(new Error('Connection lost'));
      redisService.set.mockRejectedValue(new Error('Connection lost'));

      const result = await service.suggest('sho', 5);

      expect(repository.suggest).toHaveBeenCalledWith('sho:*', 5);
      expect(result.query).toBe('sho');
      expect(result.categories).toHaveLength(1);
    });

    it('bypasses Redis cache read and write when limit is not 5', async () => {
      const result = await service.suggest('sho', 3);

      expect(redisService.get).not.toHaveBeenCalled();
      expect(repository.suggest).toHaveBeenCalledWith('sho:*', 3);
      expect(redisService.set).not.toHaveBeenCalled();
      expect(result.query).toBe('sho');
    });

    it('shares cache key after query normalization ("  SHO  " and "sho")', async () => {
      await service.suggest('  SHO  ', 5);

      expect(redisService.get).toHaveBeenCalledWith('search:suggest:sho');
      expect(repository.suggest).toHaveBeenCalledWith('sho:*', 5);
      expect(redisService.set).toHaveBeenCalledWith(
        'search:suggest:sho',
        expect.any(String),
        600,
      );
    });
  });

  describe('search()', () => {
    const mockRow = (id: string, price: string = '100'): SearchDocumentRow => ({
      id,
      document_type: 'product',
      title: `Product ${id}`,
      slug: `product-${id}`,
      content: 'Content',
      image_url: 'https://img.com/p.jpg',
      price,
      effective_price: price,
      category_id: null,
      popularity: 50,
      status: 'active',
      source_updated_at: new Date('2026-01-15T10:00:00.000Z'),
      synced_at: new Date(),
      rank: 0.85,
    });

    it('maps database rows to SearchResponse format and emits null nextCursor when no more rows', async () => {
      repository.search.mockResolvedValue({
        rows: [mockRow('1'), mockRow('2')],
        totalHits: 2,
      });

      const query: ValidatedSearchQuery = {
        q: 'running shoe',
        rawQ: 'running shoe',
        sort: 'relevance',
        limit: 10,
        fingerprint: 'test-fingerprint',
      };

      const result = await service.search(query);

      expect(result.query).toBe('running shoe');
      expect(result.totalHits).toBe(2);
      expect(result.nextCursor).toBeNull();
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        id: '1',
        type: 'product',
        title: 'Product 1',
        slug: 'product-1',
        image: 'https://img.com/p.jpg',
        price: 100,
        effectivePrice: 100,
        popularity: 50,
        updatedAt: '2026-01-15T10:00:00.000Z',
      });
    });

    it('slices rows to limit and generates encoded nextCursor when rows.length > limit', async () => {
      // 3 rows returned for limit=2 indicates there is a next page
      repository.search.mockResolvedValue({
        rows: [mockRow('1'), mockRow('2'), mockRow('3')],
        totalHits: 15,
      });

      const query: ValidatedSearchQuery = {
        q: 'running shoe',
        rawQ: 'running shoe',
        sort: 'relevance',
        limit: 2,
        fingerprint: 'test-fingerprint',
      };

      const result = await service.search(query);

      expect(result.data).toHaveLength(2);
      expect(result.totalHits).toBe(15);
      expect(result.nextCursor).not.toBeNull();

      // Verify the cursor decodes with fingerprint and last item
      const decoded = decodeCursor(result.nextCursor!, 'test-fingerprint');
      expect(decoded.id).toBe('2');
      expect(decoded.sort).toBe('relevance');
      expect(decoded.total).toBe(15);
    });
  });
});
