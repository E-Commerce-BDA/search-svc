import { describe, expect, it } from 'vitest';
import {
  computeQueryFingerprint,
  CursorValidationError,
  decodeCursor,
  encodeCursor,
  type CursorPayload,
} from '../src/search/cursor.codec.js';

describe('cursor.codec', () => {
  const baseCanonical = {
    q: 'running shoe',
    sort: 'relevance' as const,
  };

  it('computes deterministic SHA-256 fingerprint for canonical params', () => {
    const fp1 = computeQueryFingerprint(baseCanonical);
    const fp2 = computeQueryFingerprint({
      q: '  RUNNING SHOE  ',
      sort: 'relevance',
    });
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes fingerprint when any filter or sort option changes', () => {
    const fp1 = computeQueryFingerprint(baseCanonical);
    const fp2 = computeQueryFingerprint({ ...baseCanonical, type: 'product' });
    const fp3 = computeQueryFingerprint({ ...baseCanonical, category: 'trail' });
    const fp4 = computeQueryFingerprint({ ...baseCanonical, minPrice: 50 });
    const fp5 = computeQueryFingerprint({ ...baseCanonical, maxPrice: 100 });
    const fp6 = computeQueryFingerprint({ ...baseCanonical, sort: 'newest' });

    expect(new Set([fp1, fp2, fp3, fp4, fp5, fp6]).size).toBe(6);
  });

  it('encodes and decodes a relevance cursor payload roundtrip', () => {
    const fp = computeQueryFingerprint(baseCanonical);
    const payload: CursorPayload = {
      v: 1,
      q: fp,
      sort: 'relevance',
      id: '0190a8b0-0000-7000-8000-000000000201',
      rank: 0.423,
      popularity: 95,
      total: 42,
    };

    const encoded = encodeCursor(payload);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');

    const decoded = decodeCursor(encoded, fp);
    expect(decoded).toEqual(payload);
  });

  it('encodes and decodes price, newest, and popular cursor payloads', () => {
    const fp = computeQueryFingerprint(baseCanonical);

    const priceCursor: CursorPayload = {
      v: 1,
      q: fp,
      sort: 'price.asc',
      id: 'prod-123',
      price: 129.99,
      total: 10,
    };
    expect(decodeCursor(encodeCursor(priceCursor), fp)).toEqual(priceCursor);

    const newestCursor: CursorPayload = {
      v: 1,
      q: fp,
      sort: 'newest',
      id: 'prod-456',
      updatedAt: '2026-01-11T12:00:00.000Z',
      total: 10,
    };
    expect(decodeCursor(encodeCursor(newestCursor), fp)).toEqual(newestCursor);

    const popCursor: CursorPayload = {
      v: 1,
      q: fp,
      sort: 'popular',
      id: 'prod-789',
      popularity: 88,
      total: 10,
    };
    expect(decodeCursor(encodeCursor(popCursor), fp)).toEqual(popCursor);
  });

  it('throws CURSOR_INVALID when cursor does not match active query fingerprint', () => {
    const fp1 = computeQueryFingerprint({ q: 'shoes', sort: 'relevance' });
    const fp2 = computeQueryFingerprint({ q: 'shirts', sort: 'relevance' });

    const payload: CursorPayload = {
      v: 1,
      q: fp1,
      sort: 'relevance',
      id: 'prod-1',
      rank: 0.5,
      popularity: 10,
    };
    const encoded = encodeCursor(payload);

    expect(() => decodeCursor(encoded, fp2)).toThrow(CursorValidationError);
    expect(() => decodeCursor(encoded, fp2)).toThrow(
      expect.objectContaining({
        code: 'CURSOR_INVALID',
        message: expect.stringContaining('does not match'),
      }),
    );
  });

  it('throws CURSOR_INVALID for invalid base64, non-JSON, and unsupported versions', () => {
    const fp = computeQueryFingerprint(baseCanonical);

    expect(() => decodeCursor('not-valid-base64!', fp)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );

    const badJson = Buffer.from('not-json{{{').toString('base64url');
    expect(() => decodeCursor(badJson, fp)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );

    const badVersion = Buffer.from(
      JSON.stringify({ v: 2, q: fp, id: '1', sort: 'relevance' }),
    ).toString('base64url');
    expect(() => decodeCursor(badVersion, fp)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );
  });

  it('throws CURSOR_INVALID when required sort fields are missing or NaN', () => {
    const fp = computeQueryFingerprint(baseCanonical);

    const missingRank = Buffer.from(
      JSON.stringify({ v: 1, q: fp, id: '1', sort: 'relevance', popularity: 10 }),
    ).toString('base64url');
    expect(() => decodeCursor(missingRank, fp)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );

    const badDate = Buffer.from(
      JSON.stringify({ v: 1, q: fp, id: '1', sort: 'newest', updatedAt: 'not-a-date' }),
    ).toString('base64url');
    expect(() => decodeCursor(badDate, fp)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );

    const missingPrice = Buffer.from(
      JSON.stringify({ v: 1, q: fp, id: '1', sort: 'price.asc' }),
    ).toString('base64url');
    expect(() => decodeCursor(missingPrice, fp)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );
  });
});
