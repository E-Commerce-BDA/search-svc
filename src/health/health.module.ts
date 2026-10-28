import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { KafkaHealthService } from './kafka-health.service.js';

@Module({
  imports: [RedisModule],
  controllers: [HealthController],
  providers: [HealthService, KafkaHealthService],
})
export class HealthModule {}
