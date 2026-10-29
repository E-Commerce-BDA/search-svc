import { Injectable, Logger } from '@nestjs/common';
import type {
  IngestSearchDocumentsResponse,
  SearchDocument,
  SearchStats,
} from '@ecom/contracts';
import { EventMapper } from './event-mapper.js';
import { IndexerRepository } from './indexer.repository.js';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(private readonly repository: IndexerRepository) {}

  async handleEvent(
    event: unknown,
  ): Promise<'accepted' | 'skipped' | 'ignored'> {
    const doc = EventMapper.mapToSearchDocument(event);
    if (!doc) {
      return 'ignored';
    }

    const result = await this.repository.upsert(doc);
    return result.status;
  }

  async ingestMany(
    documents: SearchDocument[],
  ): Promise<IngestSearchDocumentsResponse> {
    let accepted = 0;
    let skipped = 0;
    let rejected = 0;

    for (const doc of documents) {
      try {
        const result = await this.repository.upsert(doc);
        if (result.status === 'accepted') {
          accepted++;
        } else {
          skipped++;
        }
      } catch (error) {
        // PostgreSQL error code class 23 represents constraint violations:
        // 23505 (unique_violation), 23514 (check_violation), 23502 (not_null_violation), 23503 (foreign_key)
        const code = (error as { code?: string })?.code;
        if (typeof code === 'string' && code.startsWith('23')) {
          this.logger.warn(
            `Document ${doc.documentType}:${doc.id} rejected by DB constraint: ${code}`,
          );
          rejected++;
        } else {
          // Critical/connection errors must throw to fail the request rather than masquerade as rejected records
          throw error;
        }
      }
    }

    return { accepted, skipped, rejected };
  }

  async stats(): Promise<SearchStats> {
    return this.repository.stats();
  }
}

