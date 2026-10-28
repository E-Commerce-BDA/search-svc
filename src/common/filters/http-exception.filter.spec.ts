import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { HttpExceptionFilter } from './http-exception.filter.js';

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/v1/search',
    url: '/api/v1/search',
    originalUrl: '/api/v1/search',
    method: 'GET',
    headers: { 'x-request-id': 'req-test' },
    ...overrides,
  } as unknown as Request;
}

function makeResponse(): {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

function makeHost(request: Request, response: object): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps a 401 in the shared envelope and echoes the request id', () => {
    const request = makeRequest();
    const response = makeResponse();

    filter.catch(
      new UnauthorizedException('Invalid or expired access token'),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Invalid or expired access token',
        },
        requestId: 'req-test',
        timestamp: expect.any(String),
      }),
    );
  });

  it('wraps class-validator validation failures with details', () => {
    const request = makeRequest();
    const response = makeResponse();

    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['name should not be empty'],
        error: 'Bad Request',
      }),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: ['name should not be empty'],
        },
        requestId: 'req-test',
      }),
    );
  });

  it('passes health endpoints through without envelope wrapping', () => {
    const request = makeRequest({
      path: '/health/ready',
      url: '/health/ready',
    });
    const response = makeResponse();

    filter.catch(
      new ServiceUnavailableException({
        status: 'not_ready',
        checks: { db: 'down' },
      }),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'down' },
    });
  });

  it('logs internal errors without leaking details to the client', () => {
    const loggerSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const request = makeRequest();
    const response = makeResponse();

    filter.catch(
      new Error('database connection pool dead'),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
        requestId: 'req-test',
      }),
    );
    expect(loggerSpy).toHaveBeenCalled();
  });
});
