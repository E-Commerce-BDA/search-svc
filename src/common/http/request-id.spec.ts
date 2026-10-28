import { NextFunction, Request, Response } from 'express';
import { getRequestId, requestIdMiddleware } from './request-id.js';

function makeRequest(
  headers: Record<string, string | string[] | undefined> = {},
): Request {
  return { headers } as unknown as Request;
}

describe('request id', () => {
  it('uses the incoming gateway request id', () => {
    expect(getRequestId(makeRequest({ 'x-request-id': 'gateway-123' }))).toBe(
      'gateway-123',
    );
  });

  it('uses the first value when the header is repeated', () => {
    expect(
      getRequestId(makeRequest({ 'x-request-id': ['first', 'second'] })),
    ).toBe('first');
  });

  it('generates a UUID when the header is missing or blank', () => {
    expect(getRequestId(makeRequest())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(getRequestId(makeRequest({ 'x-request-id': '   ' }))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('normalizes the request id and writes it to the response', () => {
    const request = makeRequest({ 'x-request-id': 'gateway-123' });
    const setHeader = vi.fn();
    const response = { setHeader } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(request, response, next);

    expect(request.headers['x-request-id']).toBe('gateway-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'gateway-123');
    expect(next).toHaveBeenCalledOnce();
  });
});
