import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchSuggestResponse } from '@ecom/contracts';
import { SearchService } from '../src/search/search.service.js';
import type { SearchRepository } from '../src/search/search.repository.js';
import type { RedisService } from '../src/redis/redis.service.js';
import type { SuggestRow } from '../src/search/search.types.js';

describe('SearchService', () => {
  let service: SearchService;
  let repository: { suggest: ReturnType<typeof vi.fn> };
  let redisService: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  const sampleRows: SuggestRow[] = [
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
      suggest: vi.fn().mockResolvedValue(sampleRows),
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
