import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const query = vi.hoisted(() => vi.fn());

vi.mock('../src/db/pool.js', () => ({
  getPool: () => ({ query }),
  closePool: vi.fn(),
}));

describe('Health readiness (PostgreSQL down)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    query.mockRejectedValue(new Error('postgres down'));

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
  });

  it('returns 503 with the not_ready body and dependency checks', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body).toMatchObject({
      status: 'not_ready',
      checks: { db: 'down' },
    });
    expect(['up', 'down']).toContain(response.body.checks.redis);
    expect(['up', 'down']).toContain(response.body.checks.kafka);
  });
});
