import type { CursorPayload, SearchSortOption } from './cursor.codec.js';

export interface SuggestRow {
  id: string;
  document_type: 'product' | 'category' | 'blog';
  title: string;
  slug: string;
  image_url: string | null;
  price: string | null;
  effective_price: string | null;
  popularity: number;
}

export interface ValidatedSearchQuery {
  q: string; // normalized search query
  rawQ: string; // raw query string
  type?: 'product' | 'category' | 'blog';
  category?: string; // category slug
  minPrice?: number;
  maxPrice?: number;
  sort: SearchSortOption;
  cursor?: CursorPayload;
  rawCursor?: string;
  limit: number;
  fingerprint: string;
}

export interface SearchDocumentRow {
  id: string;
  document_type: 'product' | 'category' | 'blog';
  title: string;
  slug: string;
  content: string;
  image_url: string | null;
  price: string | null;
  effective_price: string | null;
  category_id: string | null;
  popularity: number;
  status: 'active' | 'inactive';
  source_updated_at: Date;
  synced_at: Date;
  rank?: number;
  total_hits?: number;
}

export interface SearchQueryResult {
  rows: SearchDocumentRow[];
  totalHits: number;
}
