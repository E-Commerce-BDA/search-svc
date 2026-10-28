import { Module } from '@nestjs/common';

/**
 * Reserved for common providers that need DI. Global HTTP behavior lives in
 * app.setup.ts so the production bootstrap and e2e tests share one chain.
 */
@Module({})
export class CommonModule {}
