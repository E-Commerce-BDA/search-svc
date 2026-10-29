import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ingestSearchDocumentsSchema,
  type IngestSearchDocumentsPayload,
  type IngestSearchDocumentsResponse,
  type SearchStats,
} from '@ecom/contracts';
import { ServiceKeyGuard } from '../auth/guards/service-key.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { IndexerService } from './indexer.service.js';

@Controller('search/internal')
@UseGuards(ServiceKeyGuard)
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) {}

  @Post('documents')
  @HttpCode(HttpStatus.OK)
  async ingestDocuments(
    @Body(new ZodValidationPipe(ingestSearchDocumentsSchema))
    body: IngestSearchDocumentsPayload,
  ): Promise<IngestSearchDocumentsResponse> {
    return this.indexerService.ingestMany(body.documents);
  }

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  async getStats(): Promise<SearchStats> {
    return this.indexerService.stats();
  }
}

