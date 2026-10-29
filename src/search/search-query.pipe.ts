import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { searchQuerySchema } from '@ecom/contracts';
import {
  normalizeQuery,
  QueryValidationError,
} from './query-normalizer.js';
import {
  computeQueryFingerprint,
  CursorValidationError,
  decodeCursor,
  type CursorPayload,
  type SearchSortOption,
} from './cursor.codec.js';
import type { ValidatedSearchQuery } from './search.types.js';

@Injectable()
export class SearchQueryPipe
  implements PipeTransform<unknown, ValidatedSearchQuery> {
  transform(value: unknown): ValidatedSearchQuery {
    const parsed = searchQuerySchema.safeParse(value);

    if (!parsed.success) {
      const issues = parsed.error.issues;

      // 1. Unrecognized keys (unknown query parameters)
      const unrecognizedIssue = issues.find(
        (issue) => issue.code === 'unrecognized_keys',
      );
      if (unrecognizedIssue && 'keys' in unrecognizedIssue) {
        throw new BadRequestException({
          code: 'INVALID_FILTER',
          message: `Unrecognized query parameter: ${(unrecognizedIssue.keys as string[]).join(', ')}`,
        });
      }

      // 2. 'q' validation errors
      const qIssue = issues.find((issue) => issue.path[0] === 'q');
      if (qIssue) {
        if (
          qIssue.code === 'too_small' ||
          (qIssue as { expected?: string }).expected === 'string'
        ) {
          throw new BadRequestException({
            code: 'QUERY_TOO_SHORT',
            message: 'Query must be at least 2 characters',
          });
        }
        if (qIssue.code === 'too_big') {
          throw new BadRequestException({
            code: 'QUERY_INVALID',
            message: 'Query cannot exceed 100 characters',
          });
        }
      }

      // 3. 'limit' validation errors
      const limitIssue = issues.find((issue) => issue.path[0] === 'limit');
      if (limitIssue) {
        throw new BadRequestException({
          code: 'INVALID_FILTER',
          message: 'Limit must be an integer between 1 and 50',
        });
      }

      // 4. Any other schema error (e.g. invalid type, invalid sort, non-numeric price)
      const firstIssue = issues[0];
      const field = firstIssue?.path.join('.') || 'parameter';
      throw new BadRequestException({
        code: 'INVALID_FILTER',
        message: `Invalid query ${field}: ${firstIssue?.message || 'validation failed'}`,
      });
    }

    // Normalization of q
    let normalizedQ: string;
    try {
      normalizedQ = normalizeQuery(parsed.data.q);
    } catch (err) {
      if (err instanceof QueryValidationError) {
        throw new BadRequestException({
          code: err.code,
          message: err.message,
        });
      }
      throw err;
    }

    // Check minPrice <= maxPrice
    if (
      parsed.data.minPrice !== undefined &&
      parsed.data.maxPrice !== undefined &&
      parsed.data.minPrice > parsed.data.maxPrice
    ) {
      throw new BadRequestException({
        code: 'INVALID_FILTER',
        message: 'minPrice cannot be greater than maxPrice',
      });
    }

    // Check conflicting filters for category / blog searches
    if (parsed.data.type === 'category' || parsed.data.type === 'blog') {
      if (
        parsed.data.minPrice !== undefined ||
        parsed.data.maxPrice !== undefined
      ) {
        throw new BadRequestException({
          code: 'INVALID_FILTER',
          message: `Price filters cannot be applied to ${parsed.data.type} searches`,
        });
      }

      if (
        parsed.data.sort === 'price.asc' ||
        parsed.data.sort === 'price.desc'
      ) {
        throw new BadRequestException({
          code: 'INVALID_FILTER',
          message: `Price sorting cannot be applied to ${parsed.data.type} searches`,
        });
      }
    }

    // Fingerprint calculation
    const fingerprint = computeQueryFingerprint({
      q: normalizedQ,
      type: parsed.data.type,
      category: parsed.data.category,
      minPrice: parsed.data.minPrice,
      maxPrice: parsed.data.maxPrice,
      sort: parsed.data.sort as SearchSortOption,
    });

    // Cursor verification
    let cursor: CursorPayload | undefined;
    if (parsed.data.cursor) {
      try {
        cursor = decodeCursor(parsed.data.cursor, fingerprint);
      } catch (err) {
        if (err instanceof CursorValidationError) {
          throw new BadRequestException({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    }

    return {
      q: normalizedQ,
      rawQ: parsed.data.q,
      type: parsed.data.type,
      category: parsed.data.category,
      minPrice: parsed.data.minPrice,
      maxPrice: parsed.data.maxPrice,
      sort: parsed.data.sort as SearchSortOption,
      cursor,
      rawCursor: parsed.data.cursor,
      limit: parsed.data.limit,
      fingerprint,
    };
  }
}
