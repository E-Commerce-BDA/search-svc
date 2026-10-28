import { Module } from '@nestjs/common';
import { IndexerController } from './indexer.controller.js';
import { IndexerService } from './indexer.service.js';
import { IndexerRepository } from './indexer.repository.js';

@Module({
  controllers: [IndexerController],
  providers: [IndexerService, IndexerRepository],
  exports: [IndexerService, IndexerRepository],
})
export class IndexerModule {}
