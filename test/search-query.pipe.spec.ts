import { describe, expect, it } from 'vitest';
import { SearchQueryPipe } from '../src/search/search-query.pipe.js';
import {
  computeQueryFingerprint,
  encodeCursor,
} from '../src/search/cursor.codec.js';

describe('SearchQueryPipe', () => {
  const pipe = new SearchQueryPipe();

  it('validates and normalizes valid query params with defaults', () => {
    const result = pipe.transform({ q: '  Running   Shoe  ' });

    expect(result.q).toBe('running shoe');
    expect(result.rawQ).toBe('Running   Shoe');
    expect(result.sort).toBe('relevance');
    expect(result.limit).toBe(24);
    expect(result.cursor).toBeUndefined();
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts valid filters and explicit limit/sort', () => {
    const result = pipe.transform({
      q: 'trail runner',
      type: 'product',
      category: 'trail-running',
      minPrice: 50,
      maxPrice: 200,
      sort: 'price.asc',
      limit: 10,
    });

    expect(result.q).toBe('trail runner');
    expect(result.type).toBe('product');
    expect(result.category).toBe('trail-running');
    expect(result.minPrice).toBe(50);
    expect(result.maxPrice).toBe(200);
    expect(result.sort).toBe('price.asc');
    expect(result.limit).toBe(10);
  });

  it('throws QUERY_TOO_SHORT for missing, empty, or 1-character q', () => {
    expect(() => pipe.transform({})).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      }),
    );

    expect(() => pipe.transform({ q: '' })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      }),
    );

    expect(() => pipe.transform({ q: 'a' })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      }),
    );
  });

  it('throws QUERY_INVALID when q exceeds 100 characters', () => {
    const longQuery = 'a'.repeat(101);
    expect(() => pipe.transform({ q: longQuery })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'QUERY_INVALID' }),
      }),
    );
  });

  it('throws QUERY_INVALID when q reduces to empty after punctuation stripping', () => {
    expect(() => pipe.transform({ q: '&&' })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'QUERY_INVALID' }),
      }),
    );

    expect(() => pipe.transform({ q: '...' })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'QUERY_INVALID' }),
      }),
    );
  });

  it('throws INVALID_FILTER for unknown query parameters', () => {
    expect(() => pipe.transform({ q: 'shoes', extra: 'bad' })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_FILTER' }),
      }),
    );
  });

  it('throws INVALID_FILTER when limit is less than 1 or greater than 50', () => {
    expect(() => pipe.transform({ q: 'shoes', limit: 0 })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_FILTER' }),
      }),
    );

    expect(() => pipe.transform({ q: 'shoes', limit: 51 })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_FILTER' }),
      }),
    );
  });

  it('throws INVALID_FILTER when minPrice is greater than maxPrice', () => {
    expect(() =>
      pipe.transform({ q: 'shoes', minPrice: 150, maxPrice: 100 }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'INVALID_FILTER',
          message: expect.stringContaining('minPrice cannot be greater than maxPrice'),
        }),
      }),
    );
  });

  it('throws INVALID_FILTER when price filters or sorting are applied to category or blog', () => {
    expect(() =>
      pipe.transform({ q: 'shoes', type: 'blog', minPrice: 10 }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_FILTER' }),
      }),
    );

    expect(() =>
      pipe.transform({ q: 'shoes', type: 'category', maxPrice: 50 }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_FILTER' }),
      }),
    );

    expect(() =>
      pipe.transform({ q: 'shoes', type: 'blog', sort: 'price.desc' }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_FILTER' }),
      }),
    );
  });

  it('successfully decodes matching cursor', () => {
    const q = 'shoes';
    const sort = 'relevance';
    const fp = computeQueryFingerprint({ q, sort });
    const cursorStr = encodeCursor({
      v: 1,
      q: fp,
      sort,
      id: 'doc-1',
      rank: 0.8,
      popularity: 90,
      total: 25,
    });

    const result = pipe.transform({ q, cursor: cursorStr });
    expect(result.cursor).toBeDefined();
    expect(result.cursor?.id).toBe('doc-1');
    expect(result.cursor?.total).toBe(25);
  });

  it('throws CURSOR_INVALID when cursor does not match query parameters', () => {
    const fp = computeQueryFingerprint({ q: 'shirts', sort: 'relevance' });
    const cursorStr = encodeCursor({
      v: 1,
      q: fp,
      sort: 'relevance',
      id: 'doc-1',
      rank: 0.8,
      popularity: 90,
    });

    expect(() => pipe.transform({ q: 'shoes', cursor: cursorStr })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CURSOR_INVALID' }),
      }),
    );
  });
});
