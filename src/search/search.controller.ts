import { Controller, Get, Header, Query } from '@nestjs/common';
import type { SearchResponse, SearchSuggestResponse } from '@ecom/contracts';
import { SearchService } from './search.service.js';
import {
  SuggestQueryPipe,
  type ValidatedSuggestQuery,
} from './suggest-query.pipe.js';
import { SearchQueryPipe } from './search-query.pipe.js';
import type { ValidatedSearchQuery } from './search.types.js';

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

  @Get()
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=30')
  async search(
    @Query(new SearchQueryPipe()) query: ValidatedSearchQuery,
  ): Promise<SearchResponse> {
    return this.searchService.search(query);
  }
}
