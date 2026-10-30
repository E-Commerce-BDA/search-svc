import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { SearchDocument, SearchStats } from '@ecom/contracts';
import { getPool } from '../db/pool.js';
import { PG_POOL } from '../db/db.module.js';

export interface UpsertResult {
  status: 'accepted' | 'skipped';
}

interface StatsRow {
  total_documents: number;
  active_documents: number;
  product_count: number;
  category_count: number;
  blog_count: number;
  last_synced_at: Date | null;
}

@Injectable()
export class IndexerRepository {
  private readonly pool: Pool;

  constructor(@Optional() @Inject(PG_POOL) pool?: Pool) {
    this.pool = pool ?? getPool();
  }

  async upsert(doc: SearchDocument, client?: PoolClient): Promise<UpsertResult> {
    const query = `
      INSERT INTO search.search_documents (
        id, document_type, title, slug, content, image_url,
        price, effective_price, category_id, popularity, status,
        source_updated_at, synced_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, COALESCE($10, 0), $11,
        $12, now()
      )
      ON CONFLICT (document_type, id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        content = EXCLUDED.content,
        image_url = EXCLUDED.image_url,
        price = EXCLUDED.price,
        effective_price = EXCLUDED.effective_price,
        category_id = EXCLUDED.category_id,
        popularity = COALESCE($10, search.search_documents.popularity),
        status = EXCLUDED.status,
        source_updated_at = EXCLUDED.source_updated_at,
        synced_at = now()
      WHERE EXCLUDED.source_updated_at > search.search_documents.source_updated_at
      RETURNING id;
    `;

    const values = [
      doc.id,
      doc.documentType,
      doc.title,
      doc.slug,
      doc.content,
      doc.imageUrl ?? null,
      doc.price ?? null,
      doc.effectivePrice ?? null,
      doc.categoryId ?? null,
      doc.popularity ?? null,
      doc.status,
      doc.sourceUpdatedAt,
    ];

    // A caller that already opened a transaction passes its client so the
    // upsert joins that transaction instead of taking another connection.
    const result = client
      ? await client.query<{ id: string }>(query, values)
      : await this.pool.query<{ id: string }>(query, values);

    if (result.rowCount && result.rowCount > 0) {
      return { status: 'accepted' };
    }

    return { status: 'skipped' };
  }

  /**
   * Runs `fn` on a dedicated connection inside BEGIN/COMMIT, rolling back on a
   * throw. Callers pass the client down so the dedupe row and the index write
   * land in the same transaction.
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // A failed rollback means the connection is gone; the original error
        // is the one worth propagating.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Claims an event id. Returns false when another delivery already claimed
   * it, which is the only signal the caller needs to skip the write.
   */
  async markProcessed(
    client: PoolClient,
    eventId: string,
    topic: string,
  ): Promise<boolean> {
    const result = await client.query<{ event_id: string }>(
      `INSERT INTO search.processed_events (event_id, topic)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, topic],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async stats(): Promise<SearchStats> {
    const query = `
      SELECT
        count(*)::int AS total_documents,
        count(*) FILTER (WHERE status = 'active')::int AS active_documents,
        count(*) FILTER (WHERE document_type = 'product')::int AS product_count,
        count(*) FILTER (WHERE document_type = 'category')::int AS category_count,
        count(*) FILTER (WHERE document_type = 'blog')::int AS blog_count,
        max(synced_at) AS last_synced_at
      FROM search.search_documents;
    `;

    const result = await this.pool.query<StatsRow>(query);
    const row = result.rows[0];

    return {
      documents: row?.total_documents ?? 0,
      active: row?.active_documents ?? 0,
      byType: {
        product: row?.product_count ?? 0,
        category: row?.category_count ?? 0,
        blog: row?.blog_count ?? 0,
      },
      lastSyncedAt: row?.last_synced_at
        ? new Date(row.last_synced_at).toISOString()
        : null,
    };
  }
}

