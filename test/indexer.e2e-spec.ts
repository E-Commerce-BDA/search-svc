import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { closePool, getPool } from '../src/db/pool.js';
import { DEFAULT_INTERNAL_SERVICE_KEY } from '../src/auth/guards/service-key.guard.js';
import { InMemoryEventConsumer } from '../src/events/in-memory-event-consumer.js';

describe('Indexer & Internal API (e2e)', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let eventConsumer: InMemoryEventConsumer;
  const SERVICE_KEY =
    process.env.INTERNAL_SERVICE_KEY || DEFAULT_INTERNAL_SERVICE_KEY;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    pool = getPool();

    await pool.query(
      `DELETE FROM search.search_documents
       WHERE id LIKE '0190a8b0-0000-7000-8000-0000000007%'
          OR id LIKE '507f1f77bcf86cd7994390%'`,
    );
    // Event ids used by this suite; the dedupe table has no id-prefix overlap
    // with search_documents, so it needs its own cleanup.
    await pool.query(
      `DELETE FROM search.processed_events
       WHERE event_id LIKE '0190a8b0-0000-7000-8000-0000000009%'`,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    eventConsumer = app.get(InMemoryEventConsumer);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(
        `DELETE FROM search.search_documents
         WHERE id LIKE '0190a8b0-0000-7000-8000-0000000007%'
            OR id LIKE '507f1f77bcf86cd7994390%'`,
      );
      await pool.query(
        `DELETE FROM search.processed_events
         WHERE event_id LIKE '0190a8b0-0000-7000-8000-0000000009%'`,
      );
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  describe('POST /api/v1/search/internal/documents', () => {
    it('rejects unauthenticated requests without service key with SERVICE_KEY_INVALID', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .send({ documents: [] })
        .expect(401);

      expect(response.body).toMatchObject({
        error: {
          code: 'SERVICE_KEY_INVALID',
        },
      });
    });

    it('rejects requests with invalid service key with SERVICE_KEY_INVALID', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', 'wrong-service-key')
        .send({ documents: [] })
        .expect(401);

      expect(response.body).toMatchObject({
        error: {
          code: 'SERVICE_KEY_INVALID',
        },
      });
    });

    it('rejects payload with empty documents array with VALIDATION_FAILED', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({ documents: [] })
        .expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_FAILED',
        },
      });
    });

    it('ingests a batch of documents, reports counts, and supports idempotent replay', async () => {
      const doc1 = {
        id: '0190a8b0-0000-7000-8000-000000000701',
        documentType: 'product' as const,
        title: 'Batch Product One',
        slug: 'batch-product-one',
        content: 'High performance racing sneaker',
        price: 159.99,
        effectivePrice: 139.99,
        popularity: 50,
        status: 'active' as const,
        sourceUpdatedAt: '2026-10-28T15:00:00.000Z',
      };

      const doc2 = {
        id: '0190a8b0-0000-7000-8000-000000000702',
        documentType: 'product' as const,
        title: 'Batch Product Two',
        slug: 'batch-product-two',
        content: 'Daily training shoe with gel cushioning',
        price: 119.99,
        popularity: 40,
        status: 'active' as const,
        sourceUpdatedAt: '2026-10-28T15:00:00.000Z',
      };

      // 1. Initial ingestion
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({ documents: [doc1, doc2] })
        .expect(200);

      expect(res1.body).toEqual({
        accepted: 2,
        skipped: 0,
        rejected: 0,
      });

      // 2. Idempotent replay with identical timestamps: both are skipped
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({ documents: [doc1, doc2] })
        .expect(200);

      expect(res2.body).toEqual({
        accepted: 0,
        skipped: 2,
        rejected: 0,
      });

      // 3. Stale event: update with older timestamp is skipped
      const staleDoc = {
        ...doc1,
        title: 'Older Version Should Be Skipped',
        sourceUpdatedAt: '2026-10-28T14:00:00.000Z',
      };

      const res3 = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({ documents: [staleDoc] })
        .expect(200);

      expect(res3.body).toEqual({
        accepted: 0,
        skipped: 1,
        rejected: 0,
      });

      // Verify title in DB remains the newer version
      const dbCheck = await pool.query<{ title: string }>(
        `SELECT title FROM search.search_documents WHERE id = $1`,
        [doc1.id],
      );
      expect(dbCheck.rows[0].title).toBe('Batch Product One');
    });

    it('ingests a blog document using a 24-character MongoDB ObjectId', async () => {
      const mongoBlogId = '507f1f77bcf86cd799439021';
      const blogDoc = {
        id: mongoBlogId,
        documentType: 'blog' as const,
        title: 'Choosing Trail Shoes 2026',
        slug: 'choosing-trail-shoes-2026',
        content: 'Complete review of lugs and rock protection',
        imageUrl: 'https://images.example.com/mongo-blog.jpg',
        status: 'active' as const,
        sourceUpdatedAt: '2026-10-28T16:00:00.000Z',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({ documents: [blogDoc] })
        .expect(200);

      expect(response.body).toEqual({
        accepted: 1,
        skipped: 0,
        rejected: 0,
      });

      const check = await pool.query<{ id: string; title: string }>(
        `SELECT id, title FROM search.search_documents WHERE id = $1`,
        [mongoBlogId],
      );
      expect(check.rows[0]).toBeDefined();
      expect(check.rows[0].id).toBe(mongoBlogId);
      expect(check.rows[0].title).toBe('Choosing Trail Shoes 2026');
    });

    it('isolates per-document constraint errors and reports rejected count without aborting batch', async () => {
      const validDoc = {
        id: '0190a8b0-0000-7000-8000-000000000703',
        documentType: 'product' as const,
        title: 'Valid Product In Batch',
        slug: 'valid-product-in-batch',
        content: 'Valid content',
        price: 49.99,
        status: 'active' as const,
        sourceUpdatedAt: '2026-10-28T15:30:00.000Z',
      };

      const invalidDoc = {
        id: '0190a8b0-0000-7000-8000-000000000704',
        documentType: 'product' as const,
        title: 'Negative Price Violation',
        slug: 'negative-price-violation',
        content: 'Invalid content',
        price: '-99.99', // Passes Zod string union, fails DB chk_search_documents_price
        status: 'active' as const,
        sourceUpdatedAt: '2026-10-28T15:30:00.000Z',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({ documents: [validDoc, invalidDoc] })
        .expect(200);

      expect(response.body).toEqual({
        accepted: 1,
        skipped: 0,
        rejected: 1,
      });

      const validCheck = await pool.query(
        `SELECT id FROM search.search_documents WHERE id = $1`,
        [validDoc.id],
      );
      expect(validCheck.rowCount).toBe(1);

      const invalidCheck = await pool.query(
        `SELECT id FROM search.search_documents WHERE id = $1`,
        [invalidDoc.id],
      );
      expect(invalidCheck.rowCount).toBe(0);
    });

    it('returns 413 PAYLOAD_TOO_LARGE when payload exceeds 1MB limit', async () => {
      // 1MB string
      const largeContent = 'x'.repeat(1024 * 1024 + 100);

      const response = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({
          documents: [
            {
              id: '0190a8b0-0000-7000-8000-000000000705',
              documentType: 'product',
              title: 'Huge Content',
              slug: 'huge-content',
              content: largeContent,
              status: 'active',
              sourceUpdatedAt: '2026-10-28T10:00:00.000Z',
            },
          ],
        })
        .expect(413);

      expect(response.body).toMatchObject({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
        },
      });
    });
  });

  describe('GET /api/v1/search/internal/stats', () => {
    it('rejects unauthenticated requests without service key with SERVICE_KEY_INVALID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/internal/stats')
        .expect(401);

      expect(response.body).toMatchObject({
        error: {
          code: 'SERVICE_KEY_INVALID',
        },
      });
    });

    it('returns stats with Cache-Control: no-store', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/internal/stats')
        .set('x-service-key', SERVICE_KEY)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(response.body).toMatchObject({
        documents: expect.any(Number),
        active: expect.any(Number),
        byType: {
          product: expect.any(Number),
          category: expect.any(Number),
          blog: expect.any(Number),
        },
      });

      expect(response.body.documents).toBeGreaterThan(0);
    });
  });

  describe('Domain Event Consumption via InMemoryEventConsumer', () => {
    it('processes blog.updated unpublish event and sets document status to inactive', async () => {
      const blogId = '507f1f77bcf86cd799439033';

      // 1. Ingest initial published blog
      await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({
          documents: [
            {
              id: blogId,
              documentType: 'blog',
              title: 'Published Blog Article',
              slug: 'published-blog-article',
              content: 'Full article content for testing',
              status: 'active',
              sourceUpdatedAt: '2026-10-28T10:00:00.000Z',
            },
          ],
        })
        .expect(200);

      const before = await pool.query<{ status: string }>(
        `SELECT status FROM search.search_documents WHERE id = $1`,
        [blogId],
      );
      expect(before.rows[0].status).toBe('active');

      // 2. Consume blog.updated event with status: 'draft' (unpublish)
      const unpublishEvent = {
        id: '0190a8b0-0000-7000-8000-000000000901',
        topic: 'blog.updated',
        eventType: 'blog.updated',
        producer: 'cms-svc',
        timestamp: '2026-10-28T11:00:00.000Z',
        payload: {
          blogId,
          slug: 'published-blog-article',
          status: 'draft',
          title: 'Published Blog Article',
          updatedAt: '2026-10-28T11:00:00.000Z',
        },
      };

      const result = await eventConsumer.publish(unpublishEvent);
      expect(result).toEqual({
        kind: 'indexed',
        status: 'accepted',
        eventId: '0190a8b0-0000-7000-8000-000000000901',
      });

      // 3. Document in database is now inactive
      const after = await pool.query<{ status: string }>(
        `SELECT status FROM search.search_documents WHERE id = $1`,
        [blogId],
      );
      expect(after.rows[0].status).toBe('inactive');
    });

    it('processes category.updated deactivate event and sets status to inactive', async () => {
      const categoryId = '0190a8b0-0000-7000-8000-000000000788';

      // 1. Ingest initial active category
      await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send({
          documents: [
            {
              id: categoryId,
              documentType: 'category',
              title: 'Active Trail Category',
              slug: 'active-trail-category',
              content: 'Trail category description',
              status: 'active',
              sourceUpdatedAt: '2026-10-28T10:00:00.000Z',
            },
          ],
        })
        .expect(200);

      // 2. Consume deactivate event
      const deactivateEvent = {
        id: '0190a8b0-0000-7000-8000-000000000902',
        topic: 'category.updated',
        eventType: 'category.updated',
        producer: 'catalog-svc',
        timestamp: '2026-10-28T12:00:00.000Z',
        payload: {
          categoryId,
          name: 'Active Trail Category',
          slug: 'active-trail-category',
          isActive: false,
          updatedAt: '2026-10-28T12:00:00.000Z',
        },
      };

      const result = await eventConsumer.publish(deactivateEvent);
      expect(result).toEqual({
        kind: 'indexed',
        status: 'accepted',
        eventId: '0190a8b0-0000-7000-8000-000000000902',
      });

      const after = await pool.query<{ status: string }>(
        `SELECT status FROM search.search_documents WHERE id = $1`,
        [categoryId],
      );
      expect(after.rows[0].status).toBe('inactive');
    });

    it('ignores unknown event topic and returns ignored', async () => {
      const unknownEvent = {
        id: '0190a8b0-0000-7000-8000-000000000903',
        type: 'order.placed',
        producer: 'order-svc',
        timestamp: '2026-10-28T12:00:00.000Z',
        payload: {},
      };

      const result = await eventConsumer.publish(unknownEvent);
      expect(result).toEqual({
        kind: 'ignored',
        reason: 'unknown-topic',
        type: 'order.placed',
      });
    });

    it('applies an envelope id once and reports the redelivery as duplicate', async () => {
      const productId = '0190a8b0-0000-7000-8000-0000000007d1';
      const eventId = '0190a8b0-0000-7000-8000-000000000904';

      const first = {
        id: eventId,
        type: 'product.updated',
        producer: 'catalog-svc',
        timestamp: '2026-10-30T10:00:00.000Z',
        payload: {
          productId,
          name: 'First Delivery',
          slug: 'first-delivery',
          price: 50,
          status: 'active',
          updatedAt: '2026-10-30T10:00:00.000Z',
        },
      };

      const firstResult = await eventConsumer.publish(first);
      expect(firstResult).toEqual({
        kind: 'indexed',
        status: 'accepted',
        eventId,
      });

      // Same event id, newer timestamp, different content: dedupe must win over
      // the stale-timestamp guard, so the document keeps the first delivery.
      const redelivered = {
        ...first,
        timestamp: '2026-10-30T12:00:00.000Z',
        payload: {
          ...first.payload,
          name: 'Second Delivery',
          slug: 'second-delivery',
          updatedAt: '2026-10-30T12:00:00.000Z',
        },
      };

      const secondResult = await eventConsumer.publish(redelivered);
      expect(secondResult).toEqual({ kind: 'duplicate', eventId });

      const row = await pool.query<{ title: string; slug: string }>(
        `SELECT title, slug FROM search.search_documents
         WHERE id = $1 AND document_type = 'product'`,
        [productId],
      );
      expect(row.rows[0].title).toBe('First Delivery');
      expect(row.rows[0].slug).toBe('first-delivery');

      const claimed = await pool.query<{ topic: string }>(
        `SELECT topic FROM search.processed_events WHERE event_id = $1`,
        [eventId],
      );
      expect(claimed.rows[0].topic).toBe('product.updated');
    });

    it('rejects a payload that drifts from the contract without writing a document', async () => {
      const result = await eventConsumer.publish({
        id: '0190a8b0-0000-7000-8000-000000000905',
        type: 'product.updated',
        producer: 'catalog-svc',
        timestamp: '2026-10-30T10:00:00.000Z',
        payload: {
          productId: '0190a8b0-0000-7000-8000-0000000007d2',
          name: 'Missing Price',
          slug: 'missing-price',
          status: 'active',
          updatedAt: '2026-10-30T10:00:00.000Z',
        },
      });

      expect(result.kind).toBe('invalid');
      expect(result).toMatchObject({ stage: 'payload', topic: 'product.updated' });

      const row = await pool.query(
        `SELECT id FROM search.search_documents WHERE id = $1`,
        ['0190a8b0-0000-7000-8000-0000000007d2'],
      );
      expect(row.rowCount).toBe(0);
    });
  });

  describe('GET /api/v1/search/internal/consumer-stats', () => {
    it('rejects requests without the service key with SERVICE_KEY_INVALID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/internal/consumer-stats')
        .expect(401);

      expect(response.body).toMatchObject({
        error: { code: 'SERVICE_KEY_INVALID' },
      });
    });

    it('returns the counters with Cache-Control: no-store', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/internal/consumer-stats')
        .set('x-service-key', SERVICE_KEY)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(response.body).toEqual({
        accepted: expect.any(Number),
        skipped: expect.any(Number),
        duplicate: expect.any(Number),
        ignored: expect.any(Number),
        invalid: expect.any(Number),
        dlq: expect.any(Number),
      });

      // The suite consumed events above, so the in-memory path must be counted.
      expect(response.body.ignored).toBeGreaterThanOrEqual(1);
      expect(response.body.invalid).toBeGreaterThanOrEqual(1);
      // Nothing on the in-memory path can reach a DLQ.
      expect(response.body.dlq).toBe(0);
    });
  });
});
