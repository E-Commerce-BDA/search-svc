import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import type { RedisService } from '../redis/redis.service.js';
import { HealthService } from './health.service.js';
import type { KafkaHealthService } from './kafka-health.service.js';

vi.mock('../db/pool.js', () => ({
  getPool: vi.fn(),
}));

const mockedGetPool = vi.mocked(getPool);
type PingFn = ReturnType<typeof vi.fn>;

function makeService(options?: {
  query?: PingFn;
  redisPing?: PingFn;
  kafkaPing?: PingFn;
}) {
  const query =
    options?.query ?? vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  mockedGetPool.mockReturnValue({ query } as unknown as Pool);

  const redisPing = options?.redisPing ?? vi.fn().mockResolvedValue(true);
  const kafkaPing = options?.kafkaPing ?? vi.fn().mockResolvedValue(true);

  const redis = { ping: redisPing } as unknown as RedisService;
  const kafka = { ping: kafkaPing } as unknown as KafkaHealthService;

  return {
    service: new HealthService(redis, kafka),
    query,
    redisPing,
    kafkaPing,
  };
}

describe('HealthService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports liveness without touching dependencies', () => {
    const { service, query, redisPing, kafkaPing } = makeService();

    expect(service.checkLiveness()).toEqual({ status: 'ok' });
    expect(mockedGetPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(redisPing).not.toHaveBeenCalled();
    expect(kafkaPing).not.toHaveBeenCalled();
  });

  it('reports ready when PostgreSQL, Redis, and Kafka are up', async () => {
    const { service, query } = makeService();

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { db: 'up', redis: 'up', kafka: 'up' },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('stays ready when Redis is down', async () => {
    const { service } = makeService({
      redisPing: vi.fn().mockResolvedValue(false),
    });

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { db: 'up', redis: 'down', kafka: 'up' },
    });
  });

  it('stays ready when Kafka is down', async () => {
    const { service } = makeService({
      kafkaPing: vi.fn().mockResolvedValue(false),
    });

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { db: 'up', redis: 'up', kafka: 'down' },
    });
  });

  it('returns 503 when PostgreSQL is down', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = makeService({
      query: vi.fn().mockRejectedValue(new Error('postgres down')),
    });

    const error = await service
      .checkReadiness()
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'not_ready',
      checks: { db: 'down', redis: 'up', kafka: 'up' },
    });
  });

  it('never leaks the PostgreSQL error to the caller', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = makeService({
      query: vi
        .fn()
        .mockRejectedValue(new Error('password authentication failed')),
    });

    const error = await service
      .checkReadiness()
      .then(() => null)
      .catch((caught: unknown) => caught);

    const response = JSON.stringify(
      (error as ServiceUnavailableException).getResponse(),
    );
    expect(response).not.toContain('password');
    expect(response).not.toContain('authentication');
  });
});
