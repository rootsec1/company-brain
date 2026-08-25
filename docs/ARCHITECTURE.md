# Architecture

Aperture treats company context as a versioned evidence system, not a bag of embeddings. PostgreSQL records the exact object, version, authorship, location, and source-derived edges. Fast and semantic stores are projections built from that canonical layer.

![Aperture system architecture](assets/system-architecture.svg)

## Write path

1. A file, URL, plain-text record, message, or connected-source object enters a bounded ingestion API.
2. Binary/layout-heavy content uses the official Reducto SDK. Plain text is normalized directly to Markdown.
3. SHA-256 identity and source fingerprints make parsing and indexing retry-safe.
4. Raw objects and normalized Markdown go to SeaweedFS; immutable document versions, chunks, and structural edges commit to PostgreSQL.
5. Embeddings are batched through OpenRouter and indexed with metadata in Typesense.
6. A separate graph queue submits stable document identities to LightRAG. Its availability never gates search readiness.

Connector binaries use the same path. A bounded Composio download is persisted to SeaweedFS, then queued as a source-owned record so Reducto output retains the external file ID and its `attached_to` edge.

## Read path

![Progressive retrieval pipeline](assets/retrieval-pipeline.svg)

Interactive search returns typo-tolerant lexical results immediately. Vector retrieval runs concurrently, rank fusion upgrades the order, and only the top candidate set is reranked. Each stage has an explicit UI deadline; a slow provider cannot erase already-useful results.

The research agent has six read-only tools and a six-step ceiling. It chooses between search, documents, deterministic source edges, bounded graph context, and live connected-source lookup. Final company claims must resolve to stable citations.

Scheduled workflows reuse that agent. Markdown and JSON outputs become immutable local document versions linked back to every evidence document, making generated briefs searchable and auditable instead of ephemeral chat output.

## Two relationship layers

| Layer | Owner | Examples | Guarantee |
|---|---|---|---|
| Structural | PostgreSQL | `reply_to`, `attached_to`, `authored_by`, `contained_in`, `links_to`, `supersedes` | Exact, source-provenanced, version-aware |
| Semantic | LightRAG | themes, concepts, inferred entities and relations | Probabilistic, asynchronous, visibly distinguished |

This separation prevents inferred meaning from overwriting source truth while still enabling multi-hop research.

## Failure semantics

| Failure | User-visible behavior | Recovery |
|---|---|---|
| OpenRouter embedding/rerank timeout | Lexical/fused results remain available | Retry on next request or job attempt |
| LightRAG unavailable | Search, documents, and source graph continue | Independent graph jobs back off and retry |
| Reducto failure | Binary job shows a bounded, actionable error | Retry without duplicating document versions |
| Typesense unavailable | Canonical content remains safe; search reports degraded | Rebuild projection from PostgreSQL |
| Composio absent | Integrations show setup state; local product is healthy | Add optional key and restart |
| Worker restart | Active jobs return to the queue | Idempotent stages resume from durable state |

## Public boundaries

- HTTP ingestion, search, ask, document, graph, integration, workflow, job, and health endpoints live under `src/app/api`.
- Streamable HTTP MCP lives at `/mcp` and exposes the same bounded read-only research tools.
- All editable non-secret configuration lives in `config/consts.json`.
- Only the web port is exposed; infrastructure stays on the private Compose network.
