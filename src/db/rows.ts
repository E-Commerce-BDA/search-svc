import type { SearchDocumentStatus, SearchDocumentType } from '@ecom/contracts';

/**
 * Strict TypeScript representation of a row in the search.search_documents table.
 *
 * Types align with PostgreSQL / node-pg runtime behavior:
 * - numeric(12, 2) is returned as string to avoid IEEE 754 precision loss
 * - timestamptz is parsed into Date instances by node-pg
 * - tsvector is represented as string
 * - document_type and status reuse the shared contract unions
 */
export interface SearchDocumentRow {
  id: string;
  document_type: SearchDocumentType;
  title: string;
  slug: string;
  content: string;
  image_url: string | null;
  price: string | null;
  effective_price: string | null;
  category_id: string | null;
  popularity: number;
  status: SearchDocumentStatus;
  search_vector: string;
  source_updated_at: Date;
  synced_at: Date;
}
