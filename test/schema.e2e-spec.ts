import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { getPool, closePool } from '../src/db/pool.js';
import type { SearchDocumentRow } from '../src/db/rows.js';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_generated: string;
  generation_expression: string | null;
}

interface IndexInfo {
  indexname: string;
  indexdef: string;
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

describe('Search Schema (e2e)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = getPool();
  });

  afterAll(async () => {
    await closePool();
  });

  describe('DDL & column metadata', () => {
    it('creates table search.search_documents with all required columns and types', async () => {
      const result = await pool.query<ColumnInfo>(
        `SELECT column_name, data_type, is_generated, generation_expression
         FROM information_schema.columns
         WHERE table_schema = 'search' AND table_name = 'search_documents'
         ORDER BY ordinal_position`,
      );

      const columns = result.rows.map((row) => row.column_name);
      expect(columns).toEqual([
        'id',
        'document_type',
        'title',
        'slug',
        'content',
        'image_url',
        'price',
        'effective_price',
        'category_id',
        'popularity',
        'status',
        'search_vector',
        'source_updated_at',
        'synced_at',
      ]);

      const idCol = result.rows.find((col) => col.column_name === 'id');
      expect(idCol).toBeDefined();
      expect(idCol?.data_type).toBe('character varying');

      const vectorCol = result.rows.find(
        (col) => col.column_name === 'search_vector',
      );
      expect(vectorCol).toBeDefined();
      expect(vectorCol?.data_type).toBe('tsvector');
      expect(vectorCol?.is_generated).toBe('ALWAYS');
      expect(vectorCol?.generation_expression).toContain('to_tsvector');
    });

    it('creates all expected indexes including unique, GIN, and partials', async () => {
      const result = await pool.query<IndexInfo>(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'search' AND tablename = 'search_documents'`,
      );

      const indexNames = result.rows.map((row) => row.indexname);
      expect(indexNames).toContain('search_documents_pkey');
      expect(indexNames).toContain('search_documents_type_id_key');
      expect(indexNames).toContain('idx_search_documents_vector');
      expect(indexNames).toContain('idx_search_documents_active');
      expect(indexNames).toContain('idx_search_documents_popularity');
      expect(indexNames).toContain('idx_search_documents_category');

      const ginIndex = result.rows.find(
        (idx) => idx.indexname === 'idx_search_documents_vector',
      );
      expect(ginIndex?.indexdef.toLowerCase()).toContain('using gin');

      const activeIndex = result.rows.find(
        (idx) => idx.indexname === 'idx_search_documents_active',
      );
      expect(activeIndex?.indexdef).toContain(
        "WHERE ((status)::text = 'active'::text)",
      );

      const categoryIndex = result.rows.find(
        (idx) => idx.indexname === 'idx_search_documents_category',
      );
      expect(categoryIndex?.indexdef).toContain(
        "WHERE ((document_type)::text = 'product'::text)",
      );
    });
  });

  describe('Constraints & integrity', () => {
    let client: PoolClient;

    beforeAll(async () => {
      client = await pool.connect();
    });

    afterAll(() => {
      client.release();
    });

    async function withRollback(testFn: () => Promise<void>): Promise<void> {
      await client.query('BEGIN');
      try {
        await testFn();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('enforces UNIQUE (document_type, id) key constraint', async () => {
      await withRollback(async () => {
        let caughtError: PgError | null = null;
        try {
          await client.query(
            `INSERT INTO search.search_documents (
               id, document_type, title, slug, content, source_updated_at
             ) VALUES (
               '0190a8b0-0000-7000-8000-000000000201', 'product',
               'Duplicate Velocity Runner', 'dup-velocity', 'Duplicate content', now()
             )`,
          );
        } catch (error) {
          caughtError = error as PgError;
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.code).toBe('23505'); // unique_violation
        expect([
          'search_documents_type_id_key',
          'search_documents_pkey',
        ]).toContain(caughtError?.constraint);
      });
    });

    it('enforces chk_search_documents_type for valid document_type', async () => {
      await withRollback(async () => {
        let caughtError: PgError | null = null;
        try {
          await client.query(
            `INSERT INTO search.search_documents (
               id, document_type, title, slug, content, source_updated_at
             ) VALUES (
               '0190a8b0-0000-7000-8000-000000000991', 'article',
               'Invalid Document Type', 'invalid-type', 'Some content', now()
             )`,
          );
        } catch (error) {
          caughtError = error as PgError;
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.code).toBe('23514'); // check_violation
        expect(caughtError?.constraint).toBe('chk_search_documents_type');
      });
    });

    it('enforces chk_search_documents_status for valid status', async () => {
      await withRollback(async () => {
        let caughtError: PgError | null = null;
        try {
          await client.query(
            `INSERT INTO search.search_documents (
               id, document_type, title, slug, content, status, source_updated_at
             ) VALUES (
               '0190a8b0-0000-7000-8000-000000000992', 'product',
               'Invalid Status Product', 'invalid-status', 'Some content', 'archived', now()
             )`,
          );
        } catch (error) {
          caughtError = error as PgError;
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.code).toBe('23514'); // check_violation
        expect(caughtError?.constraint).toBe('chk_search_documents_status');
      });
    });

    it('enforces chk_search_documents_price (>= 0)', async () => {
      await withRollback(async () => {
        let caughtError: PgError | null = null;
        try {
          await client.query(
            `INSERT INTO search.search_documents (
               id, document_type, title, slug, content, price, source_updated_at
             ) VALUES (
               '0190a8b0-0000-7000-8000-000000000993', 'product',
               'Negative Price Product', 'negative-price', 'Some content', -19.99, now()
             )`,
          );
        } catch (error) {
          caughtError = error as PgError;
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.code).toBe('23514'); // check_violation
        expect(caughtError?.constraint).toBe('chk_search_documents_price');
      });
    });

    it('enforces chk_search_documents_effective_price (>= 0)', async () => {
      await withRollback(async () => {
        let caughtError: PgError | null = null;
        try {
          await client.query(
            `INSERT INTO search.search_documents (
               id, document_type, title, slug, content, effective_price, source_updated_at
             ) VALUES (
               '0190a8b0-0000-7000-8000-000000000994', 'product',
               'Negative Effective Price', 'neg-eff-price', 'Some content', -9.99, now()
             )`,
          );
        } catch (error) {
          caughtError = error as PgError;
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.code).toBe('23514'); // check_violation
        expect(caughtError?.constraint).toBe(
          'chk_search_documents_effective_price',
        );
      });
    });

    it('accepts MongoDB 24-hex ObjectId strings as valid document id', async () => {
      await withRollback(async () => {
        const mongoId = '507f1f77bcf86cd799439099';
        await client.query(
          `INSERT INTO search.search_documents (
             id, document_type, title, slug, content, status, source_updated_at
           ) VALUES (
             $1, 'blog', 'Mongo Blog Post', 'mongo-blog-post',
             'Testing mongo objectId insertion', 'active', now()
           )`,
          [mongoId],
        );

        const check = await client.query<{ id: string }>(
          `SELECT id FROM search.search_documents WHERE id = $1`,
          [mongoId],
        );
        expect(check.rows[0]?.id).toBe(mongoId);
      });
    });
  });

  describe('Full-text search & generated search_vector', () => {
    let client: PoolClient;

    beforeAll(async () => {
      client = await pool.connect();
    });

    afterAll(() => {
      client.release();
    });

    async function withRollback(testFn: () => Promise<void>): Promise<void> {
      await client.query('BEGIN');
      try {
        await testFn();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('matches seeded documents using to_tsquery prefix search', async () => {
      const result = await pool.query<{ title: string }>(
        `SELECT title
         FROM search.search_documents
         WHERE status = 'active'
           AND search_vector @@ to_tsquery('english', 'run:*')
         ORDER BY popularity DESC`,
      );

      expect(result.rowCount).toBeGreaterThan(0);
      const titles = result.rows.map((r) => r.title);
      expect(titles).toContain('Velocity Road Runner');
      expect(titles).toContain('Summit Trail Pro');
    });

    it('automatically generates tsvector on insert and updates it on title/content change', async () => {
      await withRollback(async () => {
        const testId = '0190a8b0-0000-7000-8000-000000000888';

        await client.query(
          `INSERT INTO search.search_documents (
             id, document_type, title, slug, content, source_updated_at
           ) VALUES (
             $1, 'product', 'Hypersonic Sprint Spikes', 'hypersonic-sprint',
             'Carbon propulsion plate built for sprinters', now()
           )`,
          [testId],
        );

        const inserted = await client.query<{ vector_text: string }>(
          `SELECT search_vector::text AS vector_text
           FROM search.search_documents
           WHERE id = $1`,
          [testId],
        );
        expect(inserted.rows[0].vector_text).toContain('hyperson');
        expect(inserted.rows[0].vector_text).toContain('propuls');

        await client.query(
          `UPDATE search.search_documents
           SET title = 'Galactic Recovery Slides',
               content = 'Ultra soft recovery foam for tired runner feet'
           WHERE id = $1`,
          [testId],
        );

        const updated = await client.query<{ vector_text: string }>(
          `SELECT search_vector::text AS vector_text
           FROM search.search_documents
           WHERE id = $1`,
          [testId],
        );
        expect(updated.rows[0].vector_text).not.toContain('hyperson');
        expect(updated.rows[0].vector_text).toContain('galact');
        expect(updated.rows[0].vector_text).toContain('foam');
      });
    });
  });

  describe('processed_events', () => {
    it('creates the dedupe table with its columns and primary key', async () => {
      const columns = await pool.query<ColumnInfo>(
        `SELECT column_name, data_type, is_generated, generation_expression
         FROM information_schema.columns
         WHERE table_schema = 'search' AND table_name = 'processed_events'
         ORDER BY ordinal_position`,
      );

      expect(columns.rows.map((row) => row.column_name)).toEqual([
        'event_id',
        'topic',
        'processed_at',
      ]);
      expect(columns.rows[0].data_type).toBe('character varying');
      expect(columns.rows[1].data_type).toBe('character varying');
      expect(columns.rows[2].data_type).toBe('timestamp with time zone');

      const pk = await pool.query<{ column_name: string }>(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
         WHERE tc.table_schema = 'search'
           AND tc.table_name = 'processed_events'
           AND tc.constraint_type = 'PRIMARY KEY'`,
      );
      expect(pk.rows.map((row) => row.column_name)).toEqual(['event_id']);
    });

    it('has the retention index the sweep will use', async () => {
      const indexes = await pool.query<IndexInfo>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'search' AND tablename = 'processed_events'`,
      );

      const names = indexes.rows.map((row) => row.indexname);
      expect(names).toContain('processed_events_pkey');
      expect(names).toContain('idx_processed_events_processed_at');
    });

    it('rejects a second insert of the same event id', async () => {
      const eventId = '0190a8b0-0000-7000-8000-0000000009ff';

      await pool.query(
        `INSERT INTO search.processed_events (event_id, topic)
         VALUES ($1, 'product.updated')
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId],
      );
      const second = await pool.query(
        `INSERT INTO search.processed_events (event_id, topic)
         VALUES ($1, 'product.updated')
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId],
      );

      // ON CONFLICT DO NOTHING is the whole dedupe contract: no row, no error.
      expect(second.rowCount).toBe(0);

      await pool.query(`DELETE FROM search.processed_events WHERE event_id = $1`, [
        eventId,
      ]);
    });
  });

  describe('Seed dataset verification', () => {
    it('has exactly 12 seeded documents with expected type and status distribution', async () => {
      const countsResult = await pool.query<{
        document_type: string;
        status: string;
        count: string;
      }>(
        `SELECT document_type, status, count(*)::text AS count
         FROM search.search_documents
         GROUP BY document_type, status
         ORDER BY document_type, status`,
      );

      const counts = countsResult.rows.reduce<Record<string, number>>(
        (acc, row) => {
          acc[`${row.document_type}:${row.status}`] = Number.parseInt(
            row.count,
            10,
          );
          return acc;
        },
        {},
      );

      expect(counts['category:active']).toBe(2);
      expect(counts['category:inactive']).toBe(1);
      expect(counts['product:active']).toBe(5);
      expect(counts['product:inactive']).toBe(1);
      expect(counts['blog:active']).toBe(2);
      expect(counts['blog:inactive']).toBe(1);

      const totalResult = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM search.search_documents`,
      );
      expect(Number.parseInt(totalResult.rows[0].total, 10)).toBe(12);
    });
  });

  describe('PostgreSQL runtime types matching SearchDocumentRow', () => {
    it('returns exact data types matching SearchDocumentRow interface for fully populated row', async () => {
      const result = await pool.query<SearchDocumentRow>(
        `SELECT *
         FROM search.search_documents
         WHERE id = '0190a8b0-0000-7000-8000-000000000201'`,
      );

      expect(result.rowCount).toBe(1);
      const row = result.rows[0];

      expect(typeof row.id).toBe('string');
      expect(row.id).toBe('0190a8b0-0000-7000-8000-000000000201');
      expect(row.document_type).toBe('product');
      expect(row.title).toBe('Velocity Road Runner');
      expect(row.slug).toBe('velocity-road-runner');
      expect(typeof row.content).toBe('string');
      expect(typeof row.image_url).toBe('string');
      // pg parses numeric columns as strings to prevent JS float precision loss
      expect(typeof row.price).toBe('string');
      expect(row.price).toBe('149.99');
      expect(typeof row.effective_price).toBe('string');
      expect(row.effective_price).toBe('129.99');
      expect(row.category_id).toBe('0190a8b0-0000-7000-8000-000000000101');
      expect(typeof row.popularity).toBe('number');
      expect(row.popularity).toBe(95);
      expect(row.status).toBe('active');
      expect(typeof row.search_vector).toBe('string');
      expect(row.source_updated_at instanceof Date).toBe(true);
      expect(row.synced_at instanceof Date).toBe(true);
    });

    it('returns null for nullable fields when not present', async () => {
      const result = await pool.query<SearchDocumentRow>(
        `SELECT *
         FROM search.search_documents
         WHERE id = '0190a8b0-0000-7000-8000-000000000204'`,
      );

      expect(result.rowCount).toBe(1);
      const row = result.rows[0];

      expect(row.title).toBe('Mountain Grip Low');
      expect(row.image_url).toBeNull();
      expect(row.effective_price).toBeNull();
      expect(typeof row.price).toBe('string');
      expect(row.price).toBe('134.50');
    });
  });
});
