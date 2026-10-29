import { Injectable, Logger } from '@nestjs/common';
import {
  searchSuggestResponseSchema,
  type SearchResponse,
  type SearchResultItem,
  type SearchSuggestBlog,
  type SearchSuggestCategory,
  type SearchSuggestProduct,
  type SearchSuggestResponse,
} from '@ecom/contracts';
import { RedisService } from '../redis/redis.service.js';
import { SearchRepository } from './search.repository.js';
import { normalizeQuery, toPrefixTsQuery } from './query-normalizer.js';
import { encodeCursor } from './cursor.codec.js';
import type { ValidatedSearchQuery } from './search.types.js';

const SUGGEST_CACHE_TTL_SECONDS = 600;
const DEFAULT_SUGGEST_LIMIT = 5;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly repository: SearchRepository,
    private readonly redisService: RedisService,
  ) {}

  async suggest(
    rawQ: string,
    limit: number = DEFAULT_SUGGEST_LIMIT,
  ): Promise<SearchSuggestResponse> {
    const normalizedQ = normalizeQuery(rawQ);
    const shouldCache = limit === DEFAULT_SUGGEST_LIMIT;
    const cacheKey = `search:suggest:${normalizedQ}`;

    if (shouldCache) {
      try {
        const cached = await this.redisService.get(cacheKey);
        if (cached) {
          try {
            const parsed: unknown = JSON.parse(cached);
            const validated = searchSuggestResponseSchema.safeParse(parsed);
            if (validated.success) {
              return validated.data;
            }
            this.logger.warn(
              `Malformed cached suggest response for key ${cacheKey}; evicting from cache`,
            );
            await this.redisService.del(cacheKey).catch(() => {});
          } catch {
            this.logger.warn(
              `Corrupt non-JSON cached suggest response for key ${cacheKey}; evicting from cache`,
            );
            await this.redisService.del(cacheKey).catch(() => {});
          }
        }
      } catch (err) {
        this.logger.warn(
          `Redis get failed for suggest key ${cacheKey}: ${(err as Error).message}. Falling back to DB.`,
        );
      }
    }

    const tsQuery = toPrefixTsQuery(normalizedQ);
    const rows = await this.repository.suggest(tsQuery, limit);

    const categories: SearchSuggestCategory[] = [];
    const products: SearchSuggestProduct[] = [];
    const blogs: SearchSuggestBlog[] = [];

    for (const row of rows) {
      if (row.document_type === 'category') {
        categories.push({
          id: row.id,
          name: row.title,
          slug: row.slug,
          image: row.image_url ?? undefined,
        });
      } else if (row.document_type === 'product') {
        products.push({
          id: row.id,
          slug: row.slug,
          name: row.title,
          image: row.image_url ?? undefined,
          price: this.parseNumeric(row.price),
          effectivePrice: this.parseNumeric(row.effective_price),
        });
      } else if (row.document_type === 'blog') {
        blogs.push({
          id: row.id,
          slug: row.slug,
          title: row.title,
          cover: row.image_url ?? undefined,
        });
      }
    }

    const response: SearchSuggestResponse = {
      query: normalizedQ,
      categories,
      products,
      blogs,
    };

    if (shouldCache) {
      try {
        await this.redisService.set(
          cacheKey,
          JSON.stringify(response),
          SUGGEST_CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.warn(
          `Redis set failed for suggest key ${cacheKey}: ${(err as Error).message}`,
        );
      }
    }

    return response;
  }

  async search(query: ValidatedSearchQuery): Promise<SearchResponse> {
    const { rows, totalHits } = await this.repository.search(query);

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor({
        v: 1,
        q: query.fingerprint,
        sort: query.sort,
        id: last.id,
        rank: last.rank,
        popularity: last.popularity,
        updatedAt: last.source_updated_at
          ? last.source_updated_at.toISOString()
          : undefined,
        price: this.parseNumeric(last.price) ?? undefined,
        total: totalHits,
      });
    }

    const data: SearchResultItem[] = pageRows.map((r) => ({
      id: r.id,
      type: r.document_type,
      title: r.title,
      slug: r.slug,
      image: r.image_url ?? undefined,
      price: this.parseNumeric(r.price),
      effectivePrice: this.parseNumeric(r.effective_price),
      popularity: r.popularity,
      updatedAt: r.source_updated_at
        ? r.source_updated_at.toISOString()
        : new Date().toISOString(),
    }));

    return {
      query: query.q,
      data,
      nextCursor,
      totalHits,
    };
  }

  private parseNumeric(value: string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
