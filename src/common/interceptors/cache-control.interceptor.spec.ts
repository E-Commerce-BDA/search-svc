import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { CacheControlInterceptor } from './cache-control.interceptor.js';

function makeContext(method: string) {
  const setHeader = vi.fn();
  const response = { setHeader };

  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => ({ method }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
    setHeader,
  };
}

describe('CacheControlInterceptor', () => {
  const interceptor = new CacheControlInterceptor();
  const next = { handle: () => of('ok') } as CallHandler;

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'sets no-store for %s',
    (method) => {
      const { context, setHeader } = makeContext(method);

      interceptor.intercept(context, next);

      expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    },
  );

  it('leaves GET responses without a cache-control override', () => {
    const { context, setHeader } = makeContext('GET');

    interceptor.intercept(context, next);

    expect(setHeader).not.toHaveBeenCalled();
  });
});
