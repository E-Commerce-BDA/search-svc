import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { PG_POOL } from '../db/db.module.js';
import { toPrefixTsQuery } from './query-normalizer.js';
import type {
  SearchDocumentRow,
  SearchQueryResult,
  SuggestRow,
  ValidatedSearchQuery,
} from './search.types.js';

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

  async search(query: ValidatedSearchQuery): Promise<SearchQueryResult> {
    const tsQuery = toPrefixTsQuery(query.q);
    if (!tsQuery || tsQuery.trim().length === 0 || query.limit <= 0) {
      return { rows: [], totalHits: 0 };
    }

    const params: unknown[] = [tsQuery]; // $1
    const whereClauses: string[] = [
      "d.status = 'active'",
      'd.search_vector @@ q.query',
    ];

    // Filter: type
    if (query.type) {
      params.push(query.type);
      whereClauses.push(`d.document_type = $${params.length}`);
    } else if (
      query.minPrice !== undefined ||
      query.maxPrice !== undefined ||
      query.sort.startsWith('price')
    ) {
      // Price filters and price sorts implicitly restrict results to products
      whereClauses.push("d.document_type = 'product'");
    }

    // Filter: category slug
    if (query.category) {
      params.push(query.category);
      whereClauses.push(
        `d.category_id::text IN (SELECT id FROM search.search_documents WHERE document_type = 'category' AND slug = $${params.length})`,
      );
    }

    // Filter: minPrice
    if (query.minPrice !== undefined) {
      params.push(query.minPrice);
      whereClauses.push(`d.price >= $${params.length}`);
    }

    // Filter: maxPrice
    if (query.maxPrice !== undefined) {
      params.push(query.maxPrice);
      whereClauses.push(`d.price <= $${params.length}`);
    }

    // Sort order & Keyset predicate
    let orderByClause = 'rank DESC, popularity DESC, id DESC';
    let cursorPredicate = '';

    if (query.sort === 'relevance') {
      orderByClause = 'rank DESC, popularity DESC, id DESC';
      if (query.cursor) {
        params.push(query.cursor.rank ?? 0);
        const pRank = params.length;
        params.push(query.cursor.popularity ?? 0);
        const pPop = params.length;
        params.push(query.cursor.id);
        const pId = params.length;
        cursorPredicate = `((rank < $${pRank}) OR (rank = $${pRank} AND popularity < $${pPop}) OR (rank = $${pRank} AND popularity = $${pPop} AND id < $${pId}))`;
      }
    } else if (query.sort === 'popular') {
      orderByClause = 'popularity DESC, id DESC';
      if (query.cursor) {
        params.push(query.cursor.popularity ?? 0);
        const pPop = params.length;
        params.push(query.cursor.id);
        const pId = params.length;
        cursorPredicate = `((popularity < $${pPop}) OR (popularity = $${pPop} AND id < $${pId}))`;
      }
    } else if (query.sort === 'newest') {
      orderByClause = 'source_updated_at DESC, id DESC';
      if (query.cursor && query.cursor.updatedAt) {
        params.push(query.cursor.updatedAt);
        const pTime = params.length;
        params.push(query.cursor.id);
        const pId = params.length;
        cursorPredicate = `((source_updated_at < $${pTime}::timestamptz) OR (source_updated_at = $${pTime}::timestamptz AND id < $${pId}))`;
      }
    } else if (query.sort === 'price.desc') {
      orderByClause = 'price DESC, id DESC';
      if (query.cursor) {
        params.push(query.cursor.price ?? 0);
        const pPrice = params.length;
        params.push(query.cursor.id);
        const pId = params.length;
        cursorPredicate = `((price < $${pPrice}) OR (price = $${pPrice} AND id < $${pId}))`;
      }
    } else if (query.sort === 'price.asc') {
      orderByClause = 'price ASC, id ASC';
      if (query.cursor) {
        params.push(query.cursor.price ?? 0);
        const pPrice = params.length;
        params.push(query.cursor.id);
        const pId = params.length;
        cursorPredicate = `((price > $${pPrice}) OR (price = $${pPrice} AND id > $${pId}))`;
      }
    }

    // Limit plus one
    params.push(query.limit + 1);
    const limitIndex = params.length;

    const sql = `
      WITH q AS (
        SELECT to_tsquery('english', $1) AS query
      ),
      matched AS (
        SELECT
          d.id,
          d.document_type,
          d.title,
          d.slug,
          d.content,
          d.image_url,
          d.price,
          d.effective_price,
          d.category_id,
          d.popularity,
          d.status,
          d.source_updated_at,
          d.synced_at,
          ts_rank_cd(d.search_vector, q.query) AS rank
        FROM search.search_documents d, q
        WHERE ${whereClauses.join(' AND ')}
      ),
      counted AS (
        SELECT count(*)::int AS total_hits FROM matched
      ),
      paged AS (
        SELECT *
        FROM matched
        ${cursorPredicate ? `WHERE ${cursorPredicate}` : ''}
        ORDER BY ${orderByClause}
        LIMIT $${limitIndex}
      )
      SELECT p.*, c.total_hits
      FROM counted c
      LEFT JOIN paged p ON true;
    `;

    const result = await this.pool.query<SearchDocumentRow>(sql, params);
    const totalHits =
      query.cursor?.total !== undefined
        ? query.cursor.total
        : (result.rows[0]?.total_hits ?? 0);

    const rows = result.rows.filter((r) => r.id !== null);
    return { rows, totalHits };
  }
}
