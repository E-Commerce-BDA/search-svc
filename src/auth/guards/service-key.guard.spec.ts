import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERNAL_SERVICE_KEY,
  ServiceKeyGuard,
} from './service-key.guard.js';

describe('ServiceKeyGuard', () => {
  let guard: ServiceKeyGuard;

  beforeEach(() => {
    guard = new ServiceKeyGuard();
    delete process.env.INTERNAL_SERVICE_KEY;
  });

  const createMockContext = (
    headers: Record<string, string | undefined>,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext;
  };

  it('throws when x-service-key is missing', () => {
    expect(() => guard.canActivate(createMockContext({}))).toThrow(
      new UnauthorizedException('Missing x-service-key header'),
    );
  });

  it('throws when x-service-key does not match the default key', () => {
    expect(() =>
      guard.canActivate(createMockContext({ 'x-service-key': 'wrong-key' })),
    ).toThrow(new UnauthorizedException('Invalid service key'));
  });

  it('allows the default key', () => {
    expect(
      guard.canActivate(
        createMockContext({ 'x-service-key': DEFAULT_INTERNAL_SERVICE_KEY }),
      ),
    ).toBe(true);
  });

  it('allows an environment-configured key', () => {
    process.env.INTERNAL_SERVICE_KEY = 'custom-prod-key-xyz';

    expect(
      guard.canActivate(
        createMockContext({ 'x-service-key': 'custom-prod-key-xyz' }),
      ),
    ).toBe(true);
  });
});
