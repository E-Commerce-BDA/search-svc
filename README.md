# search-svc

Unified search service for the E-Commerce platform.

Slice 1 is the foundation only: NestJS bootstrap, PostgreSQL pool, Redis
service, health probes, shared HTTP behavior, and the internal service-key
guard. Search indexing, suggest, full search, and the Kafka consumer start in
later slices.

## Local setup

Prerequisites:

- Node 24
- pnpm 11
- PostgreSQL on `localhost:5433` (database `ecom`, schema `search` in later
  slices)
- Redis on `redis://localhost:6379`
- Apache Kafka on `localhost:9092` (degraded dependency for readiness)

```bash
pnpm install --ignore-workspace
Copy-Item .env.example .env
pnpm start:dev
```

The service listens on `http://127.0.0.1:4090`.

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

The contracts dependency is pinned to the `@ecom/contracts@1.1.0` GitHub
Release tarball so CI and Docker do not depend on a sibling checkout.
