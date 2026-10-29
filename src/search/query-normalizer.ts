export type QueryValidationErrorCode = 'QUERY_TOO_SHORT' | 'QUERY_INVALID';

export class QueryValidationError extends Error {
  constructor(
    public readonly code: QueryValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QueryValidationError';
  }
}

/**
 * Normalizes a raw query string for prefix/full-text search.
 * - Trims whitespace
 * - Enforces bounds: trimmed raw length >= 2 and <= 100
 * - Converts to lowercase
 * - Replaces punctuation and symbols with spaces
 * - Collapses consecutive whitespace to a single space
 * - Enforces post-sanitization bounds
 */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== 'string') {
    if (raw === undefined || raw === null || raw === '') {
      throw new QueryValidationError('QUERY_TOO_SHORT', 'Query must be at least 2 characters');
    }
    throw new QueryValidationError('QUERY_INVALID', 'Query must be a string');
  }

  const rawTrimmed = raw.trim();
  if (rawTrimmed.length < 2) {
    throw new QueryValidationError('QUERY_TOO_SHORT', 'Query must be at least 2 characters');
  }
  if (raw.length > 100 || rawTrimmed.length > 100) {
    throw new QueryValidationError('QUERY_INVALID', 'Query cannot exceed 100 characters');
  }

  // Replace punctuation and symbols with space (preserve Unicode letters \p{L}, digits \p{N}, whitespace \s)
  const lower = rawTrimmed.toLowerCase();
  const sanitized = lower
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length < 2) {
    throw new QueryValidationError('QUERY_INVALID', 'Query contains no searchable words');
  }
  if (sanitized.length > 100) {
    throw new QueryValidationError('QUERY_INVALID', 'Query cannot exceed 100 characters');
  }

  return sanitized;
}

/**
 * Converts a normalized query string into a PostgreSQL prefix tsquery string.
 * Example: "run shoe" -> "run:* & shoe:*"
 */
export function toPrefixTsQuery(normalized: string): string {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return '';
  }
  return tokens.map((token) => `${token}:*`).join(' & ');
}
