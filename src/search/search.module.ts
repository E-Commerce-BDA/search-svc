import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { SearchRepository } from './search.repository.js';

@Module({
  imports: [RedisModule],
  controllers: [SearchController],
  providers: [SearchService, SearchRepository],
  exports: [SearchService, SearchRepository],
})
export class SearchModule {}
