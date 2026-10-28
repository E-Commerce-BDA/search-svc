import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Extracts the gateway request id when present; otherwise generates a fresh UUIDv4
 * to trace direct service-to-service calls.
 */
export function getRequestId(request: Request): string {
  const header = request.headers['x-request-id'];

  if (Array.isArray(header)) {
    return header[0]?.trim() || randomUUID();
  }

  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }

  return randomUUID();
}

/**
 * Normalizes the request id once and makes it visible on every response,
 * including successful requests that never reach the exception filter.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = getRequestId(request);
  request.headers['x-request-id'] = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
