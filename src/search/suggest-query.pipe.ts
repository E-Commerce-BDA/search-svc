import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { suggestQuerySchema } from '@ecom/contracts';
import {
  normalizeQuery,
  QueryValidationError,
} from './query-normalizer.js';

export interface ValidatedSuggestQuery {
  q: string;
  rawQ: string;
  limit: number;
}

@Injectable()
export class SuggestQueryPipe implements PipeTransform<unknown, ValidatedSuggestQuery> {
  transform(value: unknown): ValidatedSuggestQuery {
    const parsed = suggestQuerySchema.safeParse(value);

    if (!parsed.success) {
      const issues = parsed.error.issues;

      // Unrecognized keys check (unknown query parameters)
      const unrecognizedIssue = issues.find(
        (issue) => issue.code === 'unrecognized_keys',
      );
      if (unrecognizedIssue && 'keys' in unrecognizedIssue) {
        throw new BadRequestException({
          code: 'INVALID_FILTER',
          message: `Unrecognized query parameter: ${(unrecognizedIssue.keys as string[]).join(', ')}`,
        });
      }

      // 'q' bounds and type errors
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

      // 'limit' validation errors
      const limitIssue = issues.find((issue) => issue.path[0] === 'limit');
      if (limitIssue) {
        throw new BadRequestException({
          code: 'INVALID_FILTER',
          message: 'Limit must be an integer between 1 and 10',
        });
      }

      // Generic schema fallback
      throw new BadRequestException({
        code: 'INVALID_FILTER',
        message: 'Invalid query parameters',
      });
    }

    try {
      const normalizedQ = normalizeQuery(parsed.data.q);
      return {
        q: normalizedQ,
        rawQ: parsed.data.q,
        limit: parsed.data.limit,
      };
    } catch (err) {
      if (err instanceof QueryValidationError) {
        throw new BadRequestException({
          code: err.code,
          message: err.message,
        });
      }
      throw err;
    }
  }
}
