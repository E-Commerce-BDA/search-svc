import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const mutatingMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];
    const isMutating = mutatingMethods.includes(request.method?.toUpperCase());
    const isInternal = (request.path ?? request.url ?? '').includes(
      '/internal/',
    );

    if (isMutating || isInternal) {
      response.setHeader('Cache-Control', 'no-store');
    }

    return next.handle();
  }
}
