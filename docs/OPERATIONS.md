# Operations guide

## Service topology

`docker compose up --build` starts the application, worker, bootstrap job, PostgreSQL, Typesense, Valkey, SeaweedFS, and LightRAG. Only `127.0.0.1:3000` is published. The optional `evaluation` service runs under the `tools` profile.

## First start

```bash
cp .env.example .env
docker compose up --build
```

Bootstrap is idempotent. It applies Drizzle migrations, creates the S3 bucket and Typesense collection, and seeds the single local workspace before web and worker traffic begins.

## Health and logs

```bash
curl -fsS http://127.0.0.1:3000/api/health
docker compose ps
docker compose logs -f web worker lightrag
```

Health reports PostgreSQL, Typesense, Valkey, SeaweedFS, LightRAG, OpenRouter, and Reducto independently. Composio is optional and is represented in the Integrations UI rather than making the application unhealthy.

## Recovery model

- PostgreSQL is canonical; Typesense and LightRAG are rebuildable indexes.
- BullMQ jobs use bounded attempts, exponential backoff, progress, and idempotent identifiers.
- Graph jobs are independent from ingestion completion and discard stale versions.
- Source sync cursors commit only after normalized records and relationships are durable.
- Tombstones remove stale search and graph state while preserving deletion history.

If a derived service is unavailable, restore it and retry the affected job from Activity. Do not edit canonical rows manually unless you have captured a database backup and understand the downstream lifecycle.

## Backups

Back up the PostgreSQL and SeaweedFS volumes together. PostgreSQL contains canonical metadata and normalized content pointers; SeaweedFS contains raw and normalized objects. Valkey, Typesense, and LightRAG can be reconstructed, although preserving them shortens recovery time.

## Updating

```bash
git pull --ff-only
docker compose up --build -d
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

Review release notes and `config/consts.json` changes before updating. Compose image versions are pinned intentionally.

## Destructive reset

```bash
docker compose down --volumes
```

This permanently removes local databases, indexes, queues, and stored objects. `docker compose down` without `--volumes` preserves application data.
