import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { getPool, closePool } from '../src/db/pool.js';
import { SearchRepository } from '../src/search/search.repository.js';

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

  it('returns active categories, products, and blogs matching a prefix query', async () => {
    const rows = await repository.suggest('sho:*', 5);

    expect(rows.length).toBeGreaterThan(0);

    const categories = rows.filter((r) => r.document_type === 'category');
    const products = rows.filter((r) => r.document_type === 'product');
    const blogs = rows.filter((r) => r.document_type === 'blog');

    expect(categories.length).toBeGreaterThan(0);
    expect(products.length).toBeGreaterThan(0);
    expect(blogs.length).toBeGreaterThan(0);

    // Seed checks: Road Running matches "shoe" in content, Velocity Road Runner matches "shoe" in content,
    // and blogs match "shoe" / "shoes" in title/content.
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
