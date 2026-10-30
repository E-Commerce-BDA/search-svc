# search-svc

Unified search service for the E-Commerce platform (:4090).

Features:
- Full-text search and prefix typeahead suggest across products, categories, and blogs.
- Denormalized read-model stored in PostgreSQL (`search.search_documents`) with GIN indexes on generated `search_vector`.
- Real-time event consumption from Apache Kafka (`product.updated`, `category.updated`, `blog.updated`, `product.imported`).
- Internal batch-ingest and statistics API for backfill, disaster recovery replay, and hermetic testing.
- Typeahead suggest cached in Redis (TTL 600s for default `limit=5`) with automatic corrupt cache eviction and PostgreSQL fallback.
- Keyset cursor pagination for full search with query-bound SHA-256 fingerprinting and stable `totalHits`.

## Local setup

Prerequisites:

- Node 24
- pnpm 11
- PostgreSQL on `localhost:5433` (database `ecom`, schema `search`)
- Redis on `redis://localhost:6379`
- Apache Kafka on `localhost:9092` (degraded dependency for readiness)

```bash
pnpm install --ignore-workspace
Copy-Item .env.example .env
pnpm start:dev
```

The service listens on `http://127.0.0.1:4090`.

### Database Schema & Seed Setup (Manual)

To apply the schema and seed dataset manually via `psql`:

```bash
# Development database
psql -h localhost -p 5433 -U ecom -d ecom -f db/001-search-schema.sql
psql -h localhost -p 5433 -U ecom -d ecom -f db/002-seed-search.sql
psql -h localhost -p 5433 -U ecom -d ecom -f db/003-processed-events.sql

# E2E test database
psql -h localhost -p 5433 -U ecom -d postgres -c "CREATE DATABASE ecom_search_test;"
psql -h localhost -p 5433 -U ecom -d ecom_search_test -f db/001-search-schema.sql
psql -h localhost -p 5433 -U ecom -d ecom_search_test -f db/002-seed-search.sql
psql -h localhost -p 5433 -U ecom -d ecom_search_test -f db/003-processed-events.sql
```

`003` creates `search.processed_events`, the consumer's dedupe table. Running
without it makes `handleEvent` fail on the first mapped event with
`relation "search.processed_events" does not exist`.

## API Endpoints

### Public Endpoints

- **`GET /api/v1/search/suggest?q=<string>&limit=<1..10>`**
  - Autocomplete typeahead returning matching categories, products, and blogs.
  - Headers: `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
  - Caching: Redis cache-aside (TTL 600s for `limit=5`).
  - Error codes:
    - `400 QUERY_TOO_SHORT`: `q` missing or < 2 characters.
    - `400 QUERY_INVALID`: `q` > 100 characters or punctuation-only.
    - `400 INVALID_FILTER`: `limit` not an integer between 1 and 10, or unexpected parameters.

- **`GET /api/v1/search?q=<string>&type=<enum>&category=<slug>&minPrice=<num>&maxPrice=<num>&sort=<enum>&cursor=<string>&limit=<1..50>`**
  - Ranked full search with facet filtering and keyset cursor pagination.
  - Headers: `Cache-Control: public, max-age=30, stale-while-revalidate=30`.
  - Sort options: `relevance` (default), `price.asc`, `price.desc`, `newest`, `popular`.
  - Keyset cursor: Base64url JSON envelope bound to the canonical query fingerprint (`q`, `type`, `category`, `minPrice`, `maxPrice`, `sort`).
  - Error codes:
    - `400 QUERY_TOO_SHORT`: `q` missing or < 2 characters.
    - `400 QUERY_INVALID`: `q` > 100 characters or punctuation-only.
    - `400 INVALID_FILTER`: invalid parameter, `minPrice > maxPrice`, price filters applied to non-products.
    - `400 CURSOR_INVALID`: malformed cursor or query/filter mismatch.
    - `503 SEARCH_UNAVAILABLE`: database connection failure.

### Internal Endpoints (requires `x-service-key`)

- **`POST /api/v1/search/internal/documents`**
  - Bulk ingestion of search documents (max 500 documents, max 1MB payload).
  - Idempotent upsert with stale-event rejection (`source_updated_at`).
- **`GET /api/v1/search/internal/stats`**
  - Aggregate statistics on total, active, and per-type document counts.
- **`GET /api/v1/search/internal/consumer-stats`**
  - Per-outcome event counters: `accepted`, `skipped`, `duplicate`, `ignored`,
    `invalid`, `dlq`. Process-local, reset on boot.

## Event Consumption

Subscribed topics: `product.updated`, `category.updated`, `blog.updated`,
`product.imported` (group `search-svc`, manual commits).

Each record is classified against `@ecom/contracts` before any database work:

| Record | Action |
| --- | --- |
| Not JSON | `<topic>.dlq`, `reason: invalid-json`, committed |
| Bad envelope / bad payload | `<topic>.dlq`, `reason: invalid-envelope`/`invalid-payload`, committed, no retry |
| Unknown or unsubscribed type | counted as `ignored`, committed, warning |
| Valid, new event id | `search_documents` upsert + `processed_events` claim in one transaction |
| Valid, seen event id | counted as `duplicate`, committed, no write |
| Infrastructure error | 5 attempts (1/2/4/8/16s), then `<topic>.dlq` (`transient-exhausted`); the offset is committed only after the DLQ write succeeds |

Dedupe lives in `search.processed_events` (`db/003-processed-events.sql`), so a
redelivery is a no-op even when its payload looks newer than the stored row.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4090` | HTTP port |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `DATABASE_TEST_URL` | — | Target database for E2E tests (`*_test`) |
| `REDIS_URL` | `redis://localhost:6379` | Suggest cache; degraded dependency |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated broker list |
| `INTERNAL_SERVICE_KEY` | dev default | `x-service-key` for `/internal/*` |

## Health Probes

- `GET /health` — liveness probe, returns `200 {"status":"ok"}`.
- `GET /health/ready` — readiness probe. PostgreSQL is critical; Redis and Kafka are degraded dependencies:
  - PostgreSQL down returns `503` with `status: "not_ready"`.
  - Redis or Kafka down returns `200` with dependency marked `down`.

## Gateway Configuration (Nginx)

Example Nginx rate-limiting reverse proxy configuration:

```nginx
limit_req_zone $binary_remote_addr zone=search_rate:10m rate=30r/s;

upstream search_backend {
    server 127.0.0.1:4090;
    keepalive 32;
}

server {
    listen 80;

    location /api/v1/search/ {
        limit_req zone=search_rate burst=50 nodelay;

        proxy_pass http://search_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

## Docker

```bash
docker build -t search-svc .
docker run --rm -p 4090:4090 \
  -e DATABASE_URL=postgresql://ecom:ecom-dev-only@host.docker.internal:5433/ecom \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e KAFKA_BROKERS=host.docker.internal:9092 \
  search-svc
```

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
