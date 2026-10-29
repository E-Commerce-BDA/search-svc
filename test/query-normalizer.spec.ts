import { describe, expect, it } from 'vitest';
import {
  normalizeQuery,
  QueryValidationError,
  toPrefixTsQuery,
} from '../src/search/query-normalizer.js';

describe('query-normalizer', () => {
  describe('normalizeQuery', () => {
    it('trims, lowercases, and collapses whitespace', () => {
      expect(normalizeQuery('  Running   Shoe  ')).toBe('running shoe');
    });

    it('replaces punctuation and symbols with spaces', () => {
      expect(normalizeQuery('run-shoe!')).toBe('run shoe');
      expect(normalizeQuery('fast & furious')).toBe('fast furious');
      expect(normalizeQuery('apple / banana')).toBe('apple banana');
    });

    it('safely normalizes SQL injection strings into plain searchable tokens', () => {
      const sanitized = normalizeQuery("'; DROP TABLE users; --");
      expect(sanitized).toBe('drop table users');
    });

    it('preserves numbers and letters across languages', () => {
      expect(normalizeQuery('Nike Air Max 90')).toBe('nike air max 90');
      expect(normalizeQuery('Café Racer 2026')).toBe('café racer 2026');
    });

    it('throws QUERY_TOO_SHORT for empty, whitespace-only, or 1-character queries', () => {
      expect(() => normalizeQuery('')).toThrow(QueryValidationError);
      expect(() => normalizeQuery('')).toThrow(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
      expect(() => normalizeQuery('   ')).toThrow(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
      expect(() => normalizeQuery('a')).toThrow(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
      expect(() => normalizeQuery(' a ')).toThrow(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
    });

    it('throws QUERY_TOO_SHORT for null or undefined queries', () => {
      expect(() => normalizeQuery(undefined)).toThrow(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
      expect(() => normalizeQuery(null)).toThrow(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
    });

    it('throws QUERY_INVALID for non-string types', () => {
      expect(() => normalizeQuery(12345)).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
      expect(() => normalizeQuery({})).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
    });

    it('throws QUERY_INVALID when query exceeds 100 characters', () => {
      const longQuery = 'a'.repeat(101);
      expect(() => normalizeQuery(longQuery)).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
    });

    it('throws QUERY_INVALID when query consists only of punctuation', () => {
      expect(() => normalizeQuery('&&')).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
      expect(() => normalizeQuery('...')).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
      expect(() => normalizeQuery('!!!???')).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
      expect(() => normalizeQuery('  --  ')).toThrow(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
    });
  });

  describe('toPrefixTsQuery', () => {
    it('appends :* to single token', () => {
      expect(toPrefixTsQuery('running')).toBe('running:*');
    });

    it('joins multiple tokens with & and appends :* to each', () => {
      expect(toPrefixTsQuery('running shoe')).toBe('running:* & shoe:*');
      expect(toPrefixTsQuery('nike air max')).toBe('nike:* & air:* & max:*');
    });

    it('returns empty string for empty input', () => {
      expect(toPrefixTsQuery('')).toBe('');
    });
  });
});
