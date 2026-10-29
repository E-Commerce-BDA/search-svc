import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { getPool, closePool } from '../src/db/pool.js';
import { SearchRepository } from '../src/search/search.repository.js';
import type { ValidatedSearchQuery } from '../src/search/search.types.js';

describe('SearchRepository (e2e)', () => {
  let pool: Pool;
  let repository: SearchRepository;

  beforeAll(() => {
    pool = getPool();
    repository = new SearchRepository(pool);
  });

  afterAll(async () => {
    await closePool();
  });

  describe('suggest()', () => {
    it('returns active categories, products, and blogs matching a prefix query', async () => {
      const rows = await repository.suggest('sho:*', 5);

      expect(rows.length).toBeGreaterThan(0);

      const categories = rows.filter((r) => r.document_type === 'category');
      const products = rows.filter((r) => r.document_type === 'product');
      const blogs = rows.filter((r) => r.document_type === 'blog');

      expect(categories.length).toBeGreaterThan(0);
      expect(products.length).toBeGreaterThan(0);
      expect(blogs.length).toBeGreaterThan(0);

      expect(categories.some((c) => c.title === 'Road Running')).toBe(true);
      expect(products.some((p) => p.title === 'Velocity Road Runner')).toBe(true);
      expect(
        blogs.some((b) => b.title === 'How to Choose Your Road Running Shoe'),
      ).toBe(true);
    });

    it('never returns inactive documents', async () => {
      const rows = await repository.suggest('train:*', 10);

      const inactiveTitles = [
        'Retired Classic Trainer',
        'Track & Field',
        'Upcoming Winter Releases',
      ];

      for (const title of inactiveTitles) {
        expect(rows.some((r) => r.title === title)).toBe(false);
      }
    });

    it('enforces limit per entity type via window function partitioning', async () => {
      const rows = await repository.suggest('run:*', 1);

      const categories = rows.filter((r) => r.document_type === 'category');
      const products = rows.filter((r) => r.document_type === 'product');
      const blogs = rows.filter((r) => r.document_type === 'blog');

      expect(categories.length).toBeLessThanOrEqual(1);
      expect(products.length).toBeLessThanOrEqual(1);
      expect(blogs.length).toBeLessThanOrEqual(1);
    });

    it('returns empty array when no documents match', async () => {
      const rows = await repository.suggest('nonexistentxyz:*', 5);
      expect(rows).toEqual([]);
    });

    it('returns empty array when tsQuery is empty or limit is <= 0', async () => {
      expect(await repository.suggest('', 5)).toEqual([]);
      expect(await repository.suggest('   ', 5)).toEqual([]);
      expect(await repository.suggest('sho:*', 0)).toEqual([]);
    });
  });

  describe('search()', () => {
    it('returns ranked search documents and totalHits matching full query', async () => {
      const query: ValidatedSearchQuery = {
        q: 'runner',
        rawQ: 'runner',
        sort: 'relevance',
        limit: 10,
        fingerprint: 'dummy',
      };

      const result = await repository.search(query);

      expect(result.totalHits).toBeGreaterThan(0);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].rank).toBeDefined();
      expect(result.rows.every((r) => r.status === 'active')).toBe(true);
    });

    it('filters strictly by document_type', async () => {
      const query: ValidatedSearchQuery = {
        q: 'running',
        rawQ: 'running',
        type: 'product',
        sort: 'relevance',
        limit: 10,
        fingerprint: 'dummy',
      };

      const result = await repository.search(query);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((r) => r.document_type === 'product')).toBe(true);
    });

    it('filters products by category slug', async () => {
      const query: ValidatedSearchQuery = {
        q: 'shoe',
        rawQ: 'shoe',
        category: 'road-running',
        sort: 'relevance',
        limit: 10,
        fingerprint: 'dummy',
      };

      const result = await repository.search(query);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((r) => r.document_type === 'product')).toBe(true);
      expect(
        result.rows.some((r) => r.title === 'Velocity Road Runner'),
      ).toBe(true);
    });

    it('filters products within price range and sorts by price.asc', async () => {
      const query: ValidatedSearchQuery = {
        q: 'shoe',
        rawQ: 'shoe',
        minPrice: 130,
        maxPrice: 200,
        sort: 'price.asc',
        limit: 10,
        fingerprint: 'dummy',
      };

      const result = await repository.search(query);

      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.document_type).toBe('product');
        const price = parseFloat(row.price!);
        expect(price).toBeGreaterThanOrEqual(130);
        expect(price).toBeLessThanOrEqual(200);
      }

      // Verify ascending order
      for (let i = 1; i < result.rows.length; i++) {
        const prev = parseFloat(result.rows[i - 1].price!);
        const curr = parseFloat(result.rows[i].price!);
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it('keyset pagination advances to next page and preserves totalHits', async () => {
      const baseQuery: ValidatedSearchQuery = {
        q: 'shoe',
        rawQ: 'shoe',
        sort: 'relevance',
        limit: 2,
        fingerprint: 'dummy',
      };

      // Page 1
      const page1 = await repository.search(baseQuery);
      expect(page1.rows.length).toBeGreaterThan(2); // fetched limit+1 to detect hasMore
      const totalHits = page1.totalHits;
      expect(totalHits).toBeGreaterThan(2);

      const lastItem = page1.rows[1]; // second item on page 1

      // Page 2 using keyset cursor from last item
      const page2Query: ValidatedSearchQuery = {
        ...baseQuery,
        cursor: {
          v: 1,
          q: 'dummy',
          sort: 'relevance',
          id: lastItem.id,
          rank: lastItem.rank,
          popularity: lastItem.popularity,
          total: totalHits,
        },
      };

      const page2 = await repository.search(page2Query);
      expect(page2.totalHits).toBe(totalHits);
      expect(page2.rows.length).toBeGreaterThan(0);
      expect(page2.rows.some((r) => r.id === page1.rows[0].id)).toBe(false);
      expect(page2.rows.some((r) => r.id === page1.rows[1].id)).toBe(false);
    });

    it('returns empty rows and preserved totalHits when paging beyond last item', async () => {
      const query: ValidatedSearchQuery = {
        q: 'shoe',
        rawQ: 'shoe',
        sort: 'relevance',
        limit: 10,
        cursor: {
          v: 1,
          q: 'dummy',
          sort: 'relevance',
          id: '00000000-0000-0000-0000-000000000000',
          rank: -1,
          popularity: -1,
          total: 42,
        },
        fingerprint: 'dummy',
      };

      const result = await repository.search(query);
      expect(result.rows).toEqual([]);
      expect(result.totalHits).toBe(42);
    });
  });
});
