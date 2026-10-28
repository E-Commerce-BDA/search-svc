import { Global, Module } from '@nestjs/common';
import { getPool } from './pool.js';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => getPool(),
    },
  ],
  exports: [PG_POOL],
})
export class DbModule {}
