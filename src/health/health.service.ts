import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getPool } from '../db/pool.js';
import { RedisService } from '../redis/redis.service.js';
import { KafkaHealthService } from './kafka-health.service.js';

type DependencyStatus = 'up' | 'down';

export interface LivenessResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ready';
  checks: {
    db: 'up';
    redis: DependencyStatus;
    kafka: DependencyStatus;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly kafkaHealthService: KafkaHealthService,
  ) {}

  /**
   * Liveness: is this process able to answer HTTP?
   * Performs no external dependency calls.
   */
  checkLiveness(): LivenessResponse {
    return { status: 'ok' };
  }

  /**
   * Readiness: PostgreSQL is critical; Redis and Kafka are degraded.
   * A search query can still be served from PostgreSQL while the index
   * ingestion path is paused or the suggest cache is unavailable.
   */
  async checkReadiness(): Promise<ReadinessResponse> {
    const [db, redis, kafka] = await Promise.all([
      this.pingDb(),
      this.pingRedis(),
      this.pingKafka(),
    ]);

    if (!db) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: {
          db: 'down',
          redis: toStatus(redis),
          kafka: toStatus(kafka),
        },
      });
    }

    return {
      status: 'ready',
      checks: {
        db: 'up',
        redis: toStatus(redis),
        kafka: toStatus(kafka),
      },
    };
  }

  private async pingDb(): Promise<boolean> {
    try {
      await getPool().query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error(
        'PostgreSQL readiness probe failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      return false;
    }
  }

  private async pingRedis(): Promise<boolean> {
    try {
      return await this.redisService.ping();
    } catch (error) {
      this.logger.warn(
        `Redis readiness probe failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async pingKafka(): Promise<boolean> {
    try {
      return await this.kafkaHealthService.ping();
    } catch (error) {
      this.logger.warn(
        `Kafka readiness probe failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}

function toStatus(value: boolean): DependencyStatus {
  return value ? 'up' : 'down';
}
