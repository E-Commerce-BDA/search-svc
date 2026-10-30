BEGIN;

-- 3. processed_events
-- One row per event id the indexer has committed to search_documents. The row
-- is inserted in the same transaction as the upsert, so an at-least-once
-- redelivery finds the id and becomes a no-op instead of a second write.
CREATE TABLE IF NOT EXISTS search.processed_events (
  event_id varchar(64) NOT NULL PRIMARY KEY,
  topic varchar(64) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Retention sweep seam: DELETE ... WHERE processed_at < now() - interval '30 days'
CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at
  ON search.processed_events (processed_at);

COMMIT;
