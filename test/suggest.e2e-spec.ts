import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { searchSuggestResponseSchema } from '@ecom/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { closePool } from '../src/db/pool.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('Search Suggest API (e2e)', () => {
  let app: NestExpressApplication;
  let redisService: RedisService;

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

    redisService = app.get(RedisService);
    for (let i = 0; i < 30; i++) {
      if (await redisService.ping()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await redisService.del('search:suggest:sho').catch(() => {});
    await redisService.del('search:suggest:trail').catch(() => {});
  });

  afterAll(async () => {
    if (redisService) {
      await redisService.del('search:suggest:sho').catch(() => {});
      await redisService.del('search:suggest:trail').catch(() => {});
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  describe('GET /api/v1/search/suggest', () => {
    it('returns 200 with grouped categories, products, and blogs matching query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=sho')
        .expect(200);

      expect(response.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=300',
      );

      const parsed = searchSuggestResponseSchema.safeParse(response.body);
      expect(parsed.success).toBe(true);

      const body = response.body;
      expect(body.query).toBe('sho');
      expect(body.categories.length).toBeGreaterThan(0);
      expect(body.products.length).toBeGreaterThan(0);
      expect(body.blogs.length).toBeGreaterThan(0);

      // Seed assertions
      expect(
        body.categories.some((c: { name: string }) => c.name === 'Road Running'),
      ).toBe(true);
      expect(
        body.products.some(
          (p: { name: string }) => p.name === 'Velocity Road Runner',
        ),
      ).toBe(true);
      expect(
        body.blogs.some(
          (b: { title: string }) =>
            b.title === 'How to Choose Your Road Running Shoe',
        ),
      ).toBe(true);
    });

    it('enforces limit parameter per entity type', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=run&limit=1')
        .expect(200);

      expect(response.body.categories.length).toBeLessThanOrEqual(1);
      expect(response.body.products.length).toBeLessThanOrEqual(1);
      expect(response.body.blogs.length).toBeLessThanOrEqual(1);
    });

    it('returns empty collections when no documents match', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=nonexistentxyz')
        .expect(200);

      expect(response.body).toEqual({
        query: 'nonexistentxyz',
        categories: [],
        products: [],
        blogs: [],
      });
    });

    it('returns 400 QUERY_TOO_SHORT when q parameter is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'QUERY_TOO_SHORT',
        }),
      );
    });

    it('returns 400 QUERY_TOO_SHORT when q is empty string', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'QUERY_TOO_SHORT',
        }),
      );
    });

    it('returns 400 QUERY_TOO_SHORT when q has only 1 character', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=a')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'QUERY_TOO_SHORT',
        }),
      );
    });

    it('returns 400 QUERY_TOO_SHORT when q is whitespace-only', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=%20%20%20')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'QUERY_TOO_SHORT',
        }),
      );
    });

    it('returns 400 QUERY_INVALID when q exceeds 100 characters', async () => {
      const longQuery = 'a'.repeat(101);
      const response = await request(app.getHttpServer())
        .get(`/api/v1/search/suggest?q=${longQuery}`)
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'QUERY_INVALID',
        }),
      );
    });

    it('returns 400 QUERY_INVALID when q consists only of punctuation', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=%26%26')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'QUERY_INVALID',
        }),
      );
    });

    it('returns 400 INVALID_FILTER when limit is less than 1', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=sho&limit=0')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'INVALID_FILTER',
        }),
      );
    });

    it('returns 400 INVALID_FILTER when limit is greater than 10', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=sho&limit=11')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'INVALID_FILTER',
        }),
      );
    });

    it('returns 400 INVALID_FILTER when limit is not an integer', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=sho&limit=not-a-number')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'INVALID_FILTER',
        }),
      );
    });

    it('returns 400 INVALID_FILTER when unrecognized query parameter is passed', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=sho&unexpected=param')
        .expect(400);

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'INVALID_FILTER',
        }),
      );
    });

    it('sanitizes SQL injection strings safely without server error', async () => {
      const malicious = encodeURIComponent("'; DROP TABLE search.search_documents; --");
      const response = await request(app.getHttpServer())
        .get(`/api/v1/search/suggest?q=${malicious}`)
        .expect(200);

      expect(response.body.query).toBe('drop table search search documents');
    });

    it('populates and serves from Redis cache on repeated default limit queries', async () => {
      await redisService.del('search:suggest:trail');

      // First call: cache miss, writes to Redis
      const res1 = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=trail')
        .expect(200);

      const cached = await redisService.get('search:suggest:trail');
      expect(cached).not.toBeNull();

      // Second call: served from Redis cache
      const res2 = await request(app.getHttpServer())
        .get('/api/v1/search/suggest?q=trail')
        .expect(200);

      expect(res2.body).toEqual(res1.body);
    });
  });
});
