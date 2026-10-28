import { Global, Module } from '@nestjs/common';
import { ServiceKeyGuard } from './guards/service-key.guard.js';

@Global()
@Module({
  providers: [ServiceKeyGuard],
  exports: [ServiceKeyGuard],
})
export class AuthModule {}
