import { existsSync } from 'node:fs';

if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile();
}

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://ecom:ecom-dev-only@localhost:5433/ecom_search_test';
const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ?? DEFAULT_TEST_DATABASE_URL;

if (!/_test(?:\?|$)/.test(new URL(testDatabaseUrl).pathname)) {
  throw new Error(
    'DATABASE_TEST_URL must point at a database whose name ends in _test',
  );
}

process.env.NODE_ENV = 'test';
process.env.PORT = '4090';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_TEST_URL = testDatabaseUrl;
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:9092';
process.env.INTERNAL_SERVICE_KEY =
  process.env.INTERNAL_SERVICE_KEY ?? 'dev-internal-service-key-change-in-prod';
