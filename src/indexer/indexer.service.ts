import { Injectable, Logger } from '@nestjs/common';
import type {
  IngestSearchDocumentsResponse,
  SearchDocument,
  SearchStats,
} from '@ecom/contracts';
import { interpret, type InterpretResult } from '../events/event-interpreter.js';
import { IndexerRepository } from './indexer.repository.js';

/**
 * Everything the consumer can learn from one event. `indexed` and `duplicate`
 * come from the database, the other two are the interpreter's verdict.
 */
export type HandleEventOutcome =
  | { kind: 'indexed'; status: 'accepted' | 'skipped'; eventId: string }
  | { kind: 'duplicate'; eventId: string }
  | Extract<InterpretResult, { kind: 'ignored' }>
  | Extract<InterpretResult, { kind: 'invalid' }>;

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(private readonly repository: IndexerRepository) {}

  async handleEvent(event: unknown): Promise<HandleEventOutcome> {
    const interpreted = interpret(event);

    if (interpreted.kind !== 'mapped') {
      return interpreted;
    }

    const { eventId, topic, doc } = interpreted;

    // One transaction covers both statements: a crash between them must not
    // leave an id claimed for a document that was never written.
    return this.repository.withTransaction(async (client) => {
      const claimed = await this.repository.markProcessed(
        client,
        eventId,
        topic,
      );

      if (!claimed) {
        return { kind: 'duplicate', eventId };
      }

      const { status } = await this.repository.upsert(doc, client);
      return { kind: 'indexed', status, eventId };
    });
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

