import { Controller, Get, Header, Query } from '@nestjs/common';
import type { SearchSuggestResponse } from '@ecom/contracts';
import { SearchService } from './search.service.js';
import {
  SuggestQueryPipe,
  type ValidatedSuggestQuery,
} from './suggest-query.pipe.js';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('suggest')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  async suggest(
    @Query(new SuggestQueryPipe()) query: ValidatedSuggestQuery,
  ): Promise<SearchSuggestResponse> {
    return this.searchService.suggest(query.q, query.limit);
  }
}
