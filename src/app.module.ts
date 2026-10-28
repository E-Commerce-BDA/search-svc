import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { DbModule } from './db/db.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthModule } from './health/health.module.js';
import { CommonModule } from './common/common.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        libraryOptions: { abortEarly: false, allowUnknown: true },
      },
    }),
    DbModule,
    RedisModule,
    HealthModule,
    CommonModule,
    AuthModule,
  ],
})
export class AppModule {}
