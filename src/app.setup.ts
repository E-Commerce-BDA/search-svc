import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor.js';
import { requestIdMiddleware } from './common/http/request-id.js';

/**
 * Shared HTTP setup used by both the production bootstrap and e2e tests so
 * global behavior cannot drift between the two.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('/api/v1', {
    exclude: ['health', 'health/ready'],
  });

  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

  app.use(requestIdMiddleware);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new CacheControlInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.getHttpAdapter().getInstance().disable('x-powered-by');
}
