import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { searchResponseSchema } from '@ecom/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { closePool } from '../src/db/pool.js';
import { computeQueryFingerprint, encodeCursor } from '../src/search/cursor.codec.js';

describe('Search API (e2e)', () => {
  let app: NestExpressApplication;

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

  describe('GET /api/v1/search', () => {
    it('returns 200 with ranked results matching search query and contracts schema', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=runner')
        .expect(200);

      expect(response.headers['cache-control']).toBe(
        'public, max-age=30, stale-while-revalidate=30',
      );

      const parsed = searchResponseSchema.safeParse(response.body);
      expect(parsed.success).toBe(true);

      const body = response.body;
      expect(body.query).toBe('runner');
      expect(body.totalHits).toBeGreaterThan(0);
      expect(body.data.length).toBeGreaterThan(0);

      // Verify active seed item
      expect(
        body.data.some((d: { title: string }) => d.title === 'Velocity Road Runner'),
      ).toBe(true);
    });

    it('filters strictly by type=product', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=running&type=product')
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(
        response.body.data.every((d: { type: string }) => d.type === 'product'),
      ).toBe(true);
    });

    it('filters products by category slug', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&category=road-running')
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(
        response.body.data.every((d: { type: string }) => d.type === 'product'),
      ).toBe(true);
      expect(
        response.body.data.some(
          (d: { title: string }) => d.title === 'Velocity Road Runner',
        ),
      ).toBe(true);
    });

    it('filters products within price range and sorts by price.asc', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&minPrice=130&maxPrice=200&sort=price.asc')
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      for (const item of response.body.data) {
        expect(item.type).toBe('product');
        expect(item.price).toBeGreaterThanOrEqual(130);
        expect(item.price).toBeLessThanOrEqual(200);
      }

      for (let i = 1; i < response.body.data.length; i++) {
        expect(response.body.data[i].price).toBeGreaterThanOrEqual(
          response.body.data[i - 1].price,
        );
      }
    });

    it('sorts by popular descending', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=running&sort=popular')
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(1);
      for (let i = 1; i < response.body.data.length; i++) {
        expect(response.body.data[i - 1].popularity).toBeGreaterThanOrEqual(
          response.body.data[i].popularity,
        );
      }
    });

    it('sorts by newest descending', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=running&sort=newest')
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(1);
      for (let i = 1; i < response.body.data.length; i++) {
        const prev = new Date(response.body.data[i - 1].updatedAt).getTime();
        const curr = new Date(response.body.data[i].updatedAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('supports keyset cursor pagination with stable totalHits and no duplicate items', async () => {
      // Page 1 with limit=2
      const page1Res = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&limit=2')
        .expect(200);

      const page1 = page1Res.body;
      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const totalHits = page1.totalHits;
      expect(totalHits).toBeGreaterThan(2);

      // Page 2
      const page2Res = await request(app.getHttpServer())
        .get(`/api/v1/search?q=shoe&limit=2&cursor=${page1.nextCursor}`)
        .expect(200);

      const page2 = page2Res.body;
      expect(page2.totalHits).toBe(totalHits);
      expect(page2.data.length).toBeGreaterThan(0);

      // Check no duplicates between pages
      const page1Ids = new Set(page1.data.map((d: { id: string }) => d.id));
      for (const item of page2.data) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });

    it('returns empty data, null nextCursor, and intact totalHits when paging beyond terminal row', async () => {
      const q = 'shoe';
      const sort = 'relevance';
      const fp = computeQueryFingerprint({ q, sort });
      const terminalCursor = encodeCursor({
        v: 1,
        q: fp,
        sort,
        id: '00000000-0000-0000-0000-000000000000',
        rank: -1,
        popularity: -1,
        total: 25,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/search?q=${q}&cursor=${terminalCursor}`)
        .expect(200);

      expect(response.body).toEqual({
        query: 'shoe',
        data: [],
        nextCursor: null,
        totalHits: 25,
      });
    });

    it('returns empty array when query does not match any document', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=nonexistentxyz')
        .expect(200);

      expect(response.body).toEqual({
        query: 'nonexistentxyz',
        data: [],
        nextCursor: null,
        totalHits: 0,
      });
    });

    it('returns 400 QUERY_TOO_SHORT for missing or 1-character query', async () => {
      const resMissing = await request(app.getHttpServer())
        .get('/api/v1/search')
        .expect(400);

      expect(resMissing.body.error).toEqual(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );

      const resOneChar = await request(app.getHttpServer())
        .get('/api/v1/search?q=a')
        .expect(400);

      expect(resOneChar.body.error).toEqual(
        expect.objectContaining({ code: 'QUERY_TOO_SHORT' }),
      );
    });

    it('returns 400 QUERY_INVALID for queries exceeding 100 characters or punctuation-only', async () => {
      const resLong = await request(app.getHttpServer())
        .get(`/api/v1/search?q=${'a'.repeat(101)}`)
        .expect(400);

      expect(resLong.body.error).toEqual(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );

      const resPunct = await request(app.getHttpServer())
        .get('/api/v1/search?q=%26%26')
        .expect(400);

      expect(resPunct.body.error).toEqual(
        expect.objectContaining({ code: 'QUERY_INVALID' }),
      );
    });

    it('returns 400 INVALID_FILTER for unknown query parameters or invalid limits', async () => {
      const resUnknown = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&unknown=1')
        .expect(400);

      expect(resUnknown.body.error).toEqual(
        expect.objectContaining({ code: 'INVALID_FILTER' }),
      );

      const resLimitHigh = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&limit=51')
        .expect(400);

      expect(resLimitHigh.body.error).toEqual(
        expect.objectContaining({ code: 'INVALID_FILTER' }),
      );
    });

    it('returns 400 INVALID_FILTER when minPrice is greater than maxPrice', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&minPrice=150&maxPrice=100')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({ code: 'INVALID_FILTER' }),
      );
    });

    it('returns 400 INVALID_FILTER when price filters are applied to blogs or categories', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&type=blog&minPrice=50')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({ code: 'INVALID_FILTER' }),
      );
    });

    it('returns 400 CURSOR_INVALID for invalid or mismatched cursors', async () => {
      const resBad = await request(app.getHttpServer())
        .get('/api/v1/search?q=shoe&cursor=invalid-cursor')
        .expect(400);

      expect(resBad.body.error).toEqual(
        expect.objectContaining({ code: 'CURSOR_INVALID' }),
      );

      // Cursor for shirts passed to shoes
      const fpShirts = computeQueryFingerprint({ q: 'shirts', sort: 'relevance' });
      const mismatched = encodeCursor({
        v: 1,
        q: fpShirts,
        sort: 'relevance',
        id: '1',
        rank: 0.5,
        popularity: 10,
      });

      const resMismatch = await request(app.getHttpServer())
        .get(`/api/v1/search?q=shoe&cursor=${mismatched}`)
        .expect(400);

      expect(resMismatch.body.error).toEqual(
        expect.objectContaining({ code: 'CURSOR_INVALID' }),
      );
    });

    it('sanitizes SQL injection queries without server error', async () => {
      const malicious = encodeURIComponent("'; DROP TABLE search.search_documents; --");
      const response = await request(app.getHttpServer())
        .get(`/api/v1/search?q=${malicious}`)
        .expect(200);

      expect(response.body.query).toBe('drop table search search documents');
    });
  });
});
