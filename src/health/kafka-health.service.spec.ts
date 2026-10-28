import { ConfigService } from '@nestjs/config';
import type { Socket } from 'node:net';
import { KafkaHealthService, parseBroker } from './kafka-health.service.js';

const createConnection = vi.hoisted(() => vi.fn());

vi.mock('node:net', () => ({ createConnection }));

interface FakeSocket {
  once: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
}

function makeSocket(): FakeSocket {
  const handlers = new Map<string, () => void>();
  const socket: FakeSocket = {
    once: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return socket;
    }),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    emit: (event: string) => {
      handlers.get(event)?.();
    },
  };

  return socket;
}

function makeService(brokers = 'localhost:9092'): KafkaHealthService {
  return new KafkaHealthService({
    get: (_key: string, defaultValue?: string) => brokers ?? defaultValue,
  } as unknown as ConfigService);
}

describe('KafkaHealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses broker addresses, including IPv6 and missing ports', () => {
    expect(parseBroker('localhost:9092')).toEqual({
      host: 'localhost',
      port: 9092,
    });
    expect(parseBroker('[::1]:9092')).toEqual({ host: '::1', port: 9092 });
    expect(parseBroker('broker')).toEqual({ host: 'broker', port: 9092 });
    expect(parseBroker('')).toEqual({ host: '', port: 9092 });
  });

  it('reports up when a broker accepts a TCP connection', async () => {
    const socket = makeSocket();
    createConnection.mockReturnValue(socket as unknown as Socket);
    const service = makeService();

    const result = service.ping();
    socket.emit('connect');

    await expect(result).resolves.toBe(true);
    expect(createConnection).toHaveBeenCalledWith({
      host: 'localhost',
      port: 9092,
    });
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('reports down when a broker connection errors', async () => {
    const socket = makeSocket();
    createConnection.mockReturnValue(socket as unknown as Socket);
    const service = makeService();

    const result = service.ping();
    socket.emit('error');

    await expect(result).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('reports down when a broker connection times out', async () => {
    const socket = makeSocket();
    createConnection.mockReturnValue(socket as unknown as Socket);
    const service = makeService();

    const result = service.ping();
    socket.emit('timeout');

    await expect(result).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('reports up when any configured broker is reachable', async () => {
    const first = makeSocket();
    const second = makeSocket();
    createConnection
      .mockReturnValueOnce(first as unknown as Socket)
      .mockReturnValueOnce(second as unknown as Socket);
    const service = makeService('broker-a:9092,broker-b:9092');

    const result = service.ping();
    first.emit('error');
    second.emit('connect');

    await expect(result).resolves.toBe(true);
  });
});
