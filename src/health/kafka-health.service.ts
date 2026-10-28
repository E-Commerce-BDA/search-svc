import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection, type Socket } from 'node:net';

const DEFAULT_KAFKA_PORT = 9092;
const KAFKA_PROBE_TIMEOUT_MS = 2000;

export interface BrokerAddress {
  host: string;
  port: number;
}

@Injectable()
export class KafkaHealthService {
  private readonly logger = new Logger(KafkaHealthService.name);
  private readonly brokers: BrokerAddress[];

  constructor(configService: ConfigService) {
    const brokers = configService
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',')
      .map(parseBroker)
      .filter((broker) => broker.host.length > 0);

    this.brokers = brokers;
  }

  /**
   * Readiness only needs broker reachability. Topic existence and consumer
   * group health are verified by the ingestion consumer, not by every probe.
   */
  async ping(): Promise<boolean> {
    const results = await Promise.all(
      this.brokers.map((broker) => probeBroker(broker)),
    );
    const isUp = results.some(Boolean);

    if (!isUp) {
      this.logger.warn(
        'Kafka readiness probe failed: no broker accepted a TCP connection',
      );
    }

    return isUp;
  }
}

export function parseBroker(raw: string): BrokerAddress {
  const value = raw.trim();

  if (value.length === 0) {
    return { host: '', port: DEFAULT_KAFKA_PORT };
  }

  try {
    const url = new URL(`kafka://${value}`);
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : DEFAULT_KAFKA_PORT,
    };
  } catch {
    return { host: '', port: DEFAULT_KAFKA_PORT };
  }
}

function probeBroker({ host, port }: BrokerAddress): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket;
    let settled = false;

    try {
      socket = createConnection({ host, port });
    } catch {
      resolve(false);
      return;
    }

    const finish = (isUp: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(isUp);
    };

    socket.setTimeout(KAFKA_PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
