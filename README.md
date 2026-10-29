# search-svc

Unified search service for the E-Commerce platform.

Features:
- Full-text search and prefix typeahead suggest across products, categories, and blogs.
- Denormalized read-model stored in PostgreSQL (`search.search_documents`) with GIN indexes on generated `search_vector`.
- Real-time event consumption from Apache Kafka (`product.updated`, `category.updated`, `blog.updated`, `product.imported`).
- Internal batch-ingest and statistics API for backfill, disaster recovery replay, and hermetic testing.
- Typeahead suggest cached in Redis (TTL 600s for default `limit=5`) with automatic corrupt cache eviction and PostgreSQL fallback.

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

## API Endpoints

### Public Endpoints

- **`GET /api/v1/search/suggest?q=<string>&limit=<1..10>`**
  - Autocomplete typeahead returning matching categories, products, and blogs.
  - Headers: `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
  - Caching: Redis cache-aside (TTL 600s for `limit=5`).
  - Error codes:
    - `400 QUERY_TOO_SHORT`: `q` is missing, empty, or less than 2 characters.
    - `400 QUERY_INVALID`: `q` exceeds 100 characters or contains no searchable letters/digits after punctuation stripping.
    - `400 INVALID_FILTER`: `limit` is not an integer between 1 and 10, or unexpected query parameters are passed.

### Internal Endpoints (requires `x-service-key`)

- **`POST /api/v1/search/internal/documents`**
  - Bulk ingestion of search documents (max 500 documents, max 1MB payload).
  - Idempotent upsert with stale-event rejection (`source_updated_at`).
- **`GET /api/v1/search/internal/stats`**
  - Aggregate statistics on total, active, and per-type document counts.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4090` | HTTP port |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Suggest cache; degraded dependency |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated broker list |
| `INTERNAL_SERVICE_KEY` | dev default | `x-service-key` for `/internal/*` |

E2E tests use `DATABASE_TEST_URL`, which must point at a `*_test` database:

```sql
CREATE DATABASE ecom_search_test;
```

## Health

- `GET /health` — liveness, no dependency calls.
- `GET /health/ready` — readiness. PostgreSQL is critical; Redis and Kafka are
  degraded.

```json
{
  "status": "ready",
  "checks": { "db": "up", "redis": "up", "kafka": "up" }
}
```

PostgreSQL down returns `503` with `status: "not_ready"`. Redis or Kafka down
still returns `200` with that dependency marked `down`.

Health routes stay outside the `/api/v1` prefix.

## Docker

The image expects PostgreSQL, Redis, and Kafka to be reachable from the
container. On Docker Desktop, `host.docker.internal` reaches host services.

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

The contracts dependency is packaged from `@ecom/contracts@1.2.0` tarball (`file:..\ecom-contracts\ecom-contracts-1.2.0.tgz`).
