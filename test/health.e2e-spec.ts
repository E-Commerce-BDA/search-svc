import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { closePool } from '../src/db/pool.js';
import { KafkaHealthService } from '../src/health/kafka-health.service.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('Health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
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

  it('/health reports liveness without dependency details', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('/health/ready reports PostgreSQL as critical and Redis/Kafka as degraded', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toMatchObject({
      status: 'ready',
      checks: { db: 'up' },
    });
    expect(['up', 'down']).toContain(response.body.checks.redis);
    expect(['up', 'down']).toContain(response.body.checks.kafka);
  });

  it('stays ready when Redis and Kafka are down', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RedisService)
      .useValue({
        ping: vi.fn().mockResolvedValue(false),
        onApplicationShutdown: vi.fn(),
      })
      .overrideProvider(KafkaHealthService)
      .useValue({ ping: vi.fn().mockResolvedValue(false) })
      .compile();

    const degradedApp =
      moduleFixture.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
    configureApp(degradedApp);
    await degradedApp.init();

    try {
      const response = await request(degradedApp.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ready',
        checks: { db: 'up', redis: 'down', kafka: 'down' },
      });
    } finally {
      await degradedApp.close();
    }
  });

  it('keeps health probes outside the API prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(404);
  });

  it('wraps unknown API routes in the error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'e2e-request-id')
      .expect(404);

    expect(response.headers['x-request-id']).toBe('e2e-request-id');
    expect(response.body).toMatchObject({
      error: { code: 'NOT_FOUND' },
      requestId: 'e2e-request-id',
      timestamp: expect.any(String),
    });
  });
});
