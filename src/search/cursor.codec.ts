import { createHash } from 'node:crypto';

export type SearchSortOption =
  | 'relevance'
  | 'price.asc'
  | 'price.desc'
  | 'newest'
  | 'popular';

export interface CanonicalQueryParams {
  q: string;
  type?: 'product' | 'category' | 'blog';
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sort: SearchSortOption;
}

export interface CursorPayload {
  v: 1;
  q: string; // sha256 query and filter fingerprint
  sort: SearchSortOption;
  id: string; // primary tie-breaker
  rank?: number;
  popularity?: number;
  updatedAt?: string; // ISO string
  price?: number;
  total?: number;
}

export class CursorValidationError extends Error {
  constructor(
    public readonly code: 'CURSOR_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'CursorValidationError';
  }
}

/**
 * Computes a deterministic SHA-256 fingerprint from the query and active filter parameters.
 */
export function computeQueryFingerprint(params: CanonicalQueryParams): string {
  const parts = [
    params.q.trim().toLowerCase(),
    params.type ?? '',
    params.category ?? '',
    params.minPrice !== undefined ? String(params.minPrice) : '',
    params.maxPrice !== undefined ? String(params.maxPrice) : '',
    params.sort,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Encodes a cursor payload into an opaque base64url string.
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decodes and verifies a base64url cursor string against the expected query fingerprint.
 */
export function decodeCursor(
  raw: string,
  expectedFingerprint: string,
): CursorPayload {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new CursorValidationError('CURSOR_INVALID', 'Cursor must be a non-empty string');
  }

  let jsonStr: string;
  try {
    const buf = Buffer.from(raw, 'base64url');
    // Ensure the decoded buffer re-encodes to raw (valid base64url check)
    if (buf.length === 0) {
      throw new Error('Empty decoded buffer');
    }
    jsonStr = buf.toString('utf8');
  } catch {
    throw new CursorValidationError('CURSOR_INVALID', 'Invalid base64url cursor format');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new CursorValidationError('CURSOR_INVALID', 'Malformed cursor JSON envelope');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CursorValidationError('CURSOR_INVALID', 'Cursor payload must be an object');
  }

  const p = parsed as Record<string, unknown>;

  if (p.v !== 1) {
    throw new CursorValidationError('CURSOR_INVALID', 'Unsupported cursor version');
  }

  if (typeof p.id !== 'string' || p.id.trim().length === 0) {
    throw new CursorValidationError('CURSOR_INVALID', 'Cursor missing valid document id');
  }

  if (typeof p.q !== 'string' || p.q !== expectedFingerprint) {
    throw new CursorValidationError(
      'CURSOR_INVALID',
      'Cursor does not match active search query or filter parameters',
    );
  }

  const validSorts: SearchSortOption[] = [
    'relevance',
    'price.asc',
    'price.desc',
    'newest',
    'popular',
  ];
  if (typeof p.sort !== 'string' || !validSorts.includes(p.sort as SearchSortOption)) {
    throw new CursorValidationError('CURSOR_INVALID', 'Cursor carries invalid sort option');
  }

  const sort = p.sort as SearchSortOption;

  if (sort === 'relevance') {
    if (typeof p.rank !== 'number' || Number.isNaN(p.rank)) {
      throw new CursorValidationError('CURSOR_INVALID', 'Relevance cursor missing rank score');
    }
    if (typeof p.popularity !== 'number' || Number.isNaN(p.popularity)) {
      throw new CursorValidationError('CURSOR_INVALID', 'Relevance cursor missing popularity score');
    }
  } else if (sort === 'popular') {
    if (typeof p.popularity !== 'number' || Number.isNaN(p.popularity)) {
      throw new CursorValidationError('CURSOR_INVALID', 'Popular cursor missing popularity score');
    }
  } else if (sort === 'newest') {
    if (typeof p.updatedAt !== 'string' || Number.isNaN(Date.parse(p.updatedAt))) {
      throw new CursorValidationError('CURSOR_INVALID', 'Newest cursor missing valid updatedAt timestamp');
    }
  } else if (sort === 'price.asc' || sort === 'price.desc') {
    if (typeof p.price !== 'number' || Number.isNaN(p.price)) {
      throw new CursorValidationError('CURSOR_INVALID', 'Price cursor missing valid price value');
    }
  }

  if (p.total !== undefined && (typeof p.total !== 'number' || p.total < 0)) {
    throw new CursorValidationError('CURSOR_INVALID', 'Cursor carries invalid totalHits value');
  }

  return p as unknown as CursorPayload;
}
