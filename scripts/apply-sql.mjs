import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');

// Load .env if present without overriding existing shell environment variables
const envPath = resolve(packageRoot, '.env');
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const isTest = process.argv.includes('--test');
const connectionString = isTest
  ? (process.env.DATABASE_TEST_URL ??
    'postgresql://ecom:ecom-dev-only@localhost:5433/ecom_search_test')
  : (process.env.DATABASE_URL ??
    'postgresql://ecom:ecom-dev-only@localhost:5433/ecom');

if (!connectionString) {
  console.error(
    '[apply-sql] ERROR: Neither DATABASE_URL nor DATABASE_TEST_URL is configured.',
  );
  process.exit(1);
}

try {
  const parsedUrl = new URL(connectionString);
  const dbName = parsedUrl.pathname.replace(/^\//, '');

  if (isTest && !dbName.endsWith('_test')) {
    console.error(
      `[apply-sql] REFUSAL: Target database "${dbName}" does not end in "_test". Aborting test setup for safety.`,
    );
    process.exit(1);
  }

  console.log(
    `[apply-sql] Connecting to database "${dbName}" (isTest: ${isTest})...`,
  );

  const client = new Client({ connectionString });
  await client.connect();

  const sqlFiles = [
    resolve(packageRoot, 'db/001-search-schema.sql'),
    resolve(packageRoot, 'db/002-seed-search.sql'),
  ];

  for (const filePath of sqlFiles) {
    const filename = filePath.split(/[/\\]/).slice(-2).join('/');
    console.log(`[apply-sql] Applying ${filename}...`);
    const sql = readFileSync(filePath, 'utf8');
    await client.query(sql);
    console.log(`[apply-sql] Successfully applied ${filename}.`);
  }

  await client.end();
  console.log('[apply-sql] All search SQL scripts applied successfully.');
} catch (err) {
  console.error('[apply-sql] Execution failed:', err);
  process.exit(1);
}

