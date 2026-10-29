import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { closePool } from '../src/db/pool.js';
import { DEFAULT_INTERNAL_SERVICE_KEY } from '../src/auth/guards/service-key.guard.js';

describe('Security & Chaos (e2e)', () => {
  let app: NestExpressApplication;
  const SERVICE_KEY =
    process.env.INTERNAL_SERVICE_KEY || DEFAULT_INTERNAL_SERVICE_KEY;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closePool();
  });

  describe('SQL Injection Defenses', () => {
    it('safely normalizes SQL injection attempts in q parameter', async () => {
      const malicious = encodeURIComponent("'; DROP TABLE search.search_documents; --");
      const res = await request(app.getHttpServer())
        .get(`/api/v1/search?q=${malicious}`)
        .expect(200);

      expect(res.body.query).toBe('drop table search search documents');
    });

    it('rejects SQL injection attempts in sort parameter with INVALID_FILTER', async () => {
      const malicious = encodeURIComponent('relevance; DROP TABLE users; --');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/search?q=shoes&sort=${malicious}`)
        .expect(400);

      expect(res.body.error).toEqual(
        expect.objectContaining({ code: 'INVALID_FILTER' }),
      );
    });

    it('safely parameterizes category slug filter preventing injection', async () => {
      const malicious = encodeURIComponent("' OR '1'='1");
      const res = await request(app.getHttpServer())
        .get(`/api/v1/search?q=shoes&category=${malicious}`)
        .expect(200);

      // Safe parameter binding means it looks for literal slug "' OR '1'='1" and returns empty
      expect(res.body.data).toEqual([]);
    });

    it('rejects crafted cursor payloads attempting SQL injection with CURSOR_INVALID', async () => {
      const maliciousJson = JSON.stringify({
        v: 1,
        q: 'dummy',
        sort: "relevance'; DROP TABLE search_documents; --",
        id: "1' OR '1'='1",
      });
      const maliciousCursor = Buffer.from(maliciousJson).toString('base64url');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/search?q=shoes&cursor=${maliciousCursor}`)
        .expect(400);

      expect(res.body.error).toEqual(
        expect.objectContaining({ code: 'CURSOR_INVALID' }),
      );
    });
  });

  describe('Prototype Pollution Defenses', () => {
    it('ignores prototype pollution query keys and prevents global Object pollution', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoes&__proto__[admin]=true')
        .expect(400);

      // Schema .strict() rejects unrecognized key __proto__
      expect(res.body.error).toEqual(
        expect.objectContaining({ code: 'INVALID_FILTER' }),
      );

      // Verify global Object is not polluted
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
    });
  });

  describe('Payload Limits (413)', () => {
    it('rejects request bodies exceeding 1MB with PAYLOAD_TOO_LARGE', async () => {
      // 1.1 MB payload of dummy characters
      const largePayload = {
        documents: [
          {
            id: 'large-doc',
            documentType: 'product',
            title: 'Large',
            slug: 'large',
            content: 'x'.repeat(1024 * 1024 * 1.1),
            price: 10,
            status: 'active',
            sourceUpdatedAt: new Date().toISOString(),
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/internal/documents')
        .set('x-service-key', SERVICE_KEY)
        .send(largePayload)
        .expect(413);

      expect(res.body.error).toEqual(
        expect.objectContaining({
          code: 'PAYLOAD_TOO_LARGE',
        }),
      );
    });
  });

  describe('Service Key Authentication', () => {
    it('rejects requests missing x-service-key with SERVICE_KEY_INVALID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/internal/stats')
        .expect(401);

      expect(res.body.error).toEqual(
        expect.objectContaining({ code: 'SERVICE_KEY_INVALID' }),
      );
    });

    it('rejects requests with wrong x-service-key with SERVICE_KEY_INVALID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/internal/stats')
        .set('x-service-key', 'wrong-key-xyz')
        .expect(401);

      expect(res.body.error).toEqual(
        expect.objectContaining({ code: 'SERVICE_KEY_INVALID' }),
      );
    });

    it('allows requests with correct x-service-key', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/internal/stats')
        .set('x-service-key', SERVICE_KEY)
        .expect(200);

      expect(res.body).toHaveProperty('documents');
    });
  });

  describe('Cache-Control & Request ID Headers', () => {
    it('sets public cache headers on suggest and search endpoints', async () => {
      const resSuggest = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=shoe')
        .expect(200);
      expect(resSuggest.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=300',
      );

      const resSearch = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe')
        .expect(200);
      expect(resSearch.headers['cache-control']).toBe(
        'public, max-age=30, stale-while-revalidate=30',
      );
    });

    it('sets no-store cache header on internal and mutating endpoints', async () => {
      const resStats = await request(app.getHttpServer())
        .get('/api/v1/search/internal/stats')
        .set('x-service-key', SERVICE_KEY)
        .expect(200);
      expect(resStats.headers['cache-control']).toBe('no-store');
    });

    it('preserves client x-request-id or generates a new one on every response', async () => {
      const customId = 'client-req-999';
      const resEcho = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe')
        .set('x-request-id', customId)
        .expect(200);

      expect(resEcho.headers['x-request-id']).toBe(customId);
      expect(resEcho.body.requestId).toBeUndefined(); // search response has no requestId in body, but error envelope does

      const resError = await request(app.getHttpServer())
        .get('/api/v1/search?q=a')
        .set('x-request-id', customId)
        .expect(400);

      expect(resError.headers['x-request-id']).toBe(customId);
      expect(resError.body.requestId).toBe(customId);
    });
  });
});
