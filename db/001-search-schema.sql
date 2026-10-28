BEGIN;

CREATE SCHEMA IF NOT EXISTS search;

-- 1. search_documents
-- Denormalized, eventually consistent read model indexed from Kafka events (product, category, blog).
-- search_vector is automatically maintained via PostgreSQL GENERATED ALWAYS AS ... STORED.
CREATE TABLE IF NOT EXISTS search.search_documents (
  id uuid NOT NULL,
  document_type varchar(20) NOT NULL,
  title varchar(255) NOT NULL,
  slug varchar(280) NOT NULL,
  content text NOT NULL,
  image_url varchar(2048),
  price numeric(12,2),
  effective_price numeric(12,2),
  category_id uuid,
  popularity integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'active',
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || content)
  ) STORED,
  source_updated_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_documents_pkey PRIMARY KEY (id),
  CONSTRAINT chk_search_documents_type CHECK (document_type IN ('product', 'category', 'blog')),
  CONSTRAINT chk_search_documents_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT chk_search_documents_price CHECK (price >= 0),
  CONSTRAINT chk_search_documents_effective_price CHECK (effective_price >= 0)
);

-- Explicit target for ON CONFLICT (document_type, id) upserts
CREATE UNIQUE INDEX IF NOT EXISTS search_documents_type_id_key
  ON search.search_documents (document_type, id);

-- Full-text search index over the generated tsvector
CREATE INDEX IF NOT EXISTS idx_search_documents_vector
  ON search.search_documents USING gin (search_vector);

-- Partial index for active documents (the primary filter for public queries)
CREATE INDEX IF NOT EXISTS idx_search_documents_active
  ON search.search_documents (status)
  WHERE status = 'active';

-- Btree index for popularity-based ranking / tiebreaking
CREATE INDEX IF NOT EXISTS idx_search_documents_popularity
  ON search.search_documents (popularity);

-- Partial index for products by category
CREATE INDEX IF NOT EXISTS idx_search_documents_category
  ON search.search_documents (document_type, category_id)
  WHERE document_type = 'product';

COMMIT;
