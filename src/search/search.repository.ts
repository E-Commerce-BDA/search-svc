import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { PG_POOL } from '../db/db.module.js';
import type { SuggestRow } from './search.types.js';

@Injectable()
export class SearchRepository {
  private readonly pool: Pool;

  constructor(@Optional() @Inject(PG_POOL) pool?: Pool) {
    this.pool = pool ?? getPool();
  }

  async suggest(tsQuery: string, limit: number): Promise<SuggestRow[]> {
    if (!tsQuery || tsQuery.trim().length === 0 || limit <= 0) {
      return [];
    }

    const query = `
      WITH q AS (
        SELECT to_tsquery('english', $1) AS query
      ),
      ranked AS (
        SELECT
          d.id,
          d.document_type,
          d.title,
          d.slug,
          d.image_url,
          d.price,
          d.effective_price,
          d.popularity,
          ROW_NUMBER() OVER (
            PARTITION BY d.document_type
            ORDER BY ts_rank_cd(d.search_vector, q.query) DESC,
                     d.popularity DESC,
                     d.id
          ) AS rn
        FROM search.search_documents d, q
        WHERE d.status = 'active'
          AND d.search_vector @@ q.query
      )
      SELECT id, document_type, title, slug, image_url,
             price, effective_price, popularity
      FROM ranked
      WHERE rn <= $2
      ORDER BY document_type, rn;
    `;

    const result = await this.pool.query<SuggestRow>(query, [tsQuery, limit]);
    return result.rows;
  }
}
