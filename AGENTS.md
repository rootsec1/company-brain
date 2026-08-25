# AGENTS.md

This file is the operating contract for coding agents working in Aperture. Read it before changing code, and keep changes narrow, reversible, and verified.

## Product intent

Aperture is an ultra-fast, single-workspace company brain. It ingests company context, preserves exact source relationships, adds semantic graph context asynchronously, and exposes grounded evidence to people and agents.

The moat is the combination of retrieval quality, interaction speed, evidence fidelity, and a calm product experience. Protect all four.

## Non-negotiable invariants

1. **One configuration source.** Non-secret settings belong in `config/consts.json` and are validated by `src/lib/config.ts`. Do not scatter ports, model IDs, timeouts, limits, or feature flags through the codebase.
2. **Three environment variables maximum.** `OPENROUTER_API_KEY` and `REDUCTO_API_KEY` are required; `COMPOSIO_API_KEY` is optional. Never add infrastructure credentials to `.env`—local service credentials are intentionally internal Compose constants.
3. **PostgreSQL is canonical.** Typesense, SeaweedFS, and LightRAG are derived stores. A partial index must be recoverable from canonical records.
4. **Relationships come first.** Preserve threads, attachments, authors, folders, links, mentions, and versions before semantic enrichment.
5. **Graph enrichment never blocks search.** LightRAG work is asynchronous and degradable. Search and ingestion must remain useful while it catches up or is unavailable.
6. **External access is read-only.** Composio actions that create, update, delete, send, post, upload, comment, or reply must never reach an agent, sync recipe, or MCP client.
7. **Claims require evidence.** Company-specific factual claims must resolve to stable document/chunk citations. Unsupported claims are omitted or marked uncertain.
8. **Latency is a feature.** Lexical results paint first; vector fusion and reranking upgrade progressively. Avoid serial provider calls on interactive paths.
9. **No application auth in v1.** Do not add partial authentication. The app binds to localhost and assumes one trusted workspace.

## Repository map

```text
src/app/                 Next.js routes and public HTTP interfaces
src/components/          Product surfaces and shared client UI
src/lib/agent/           Bounded research agent and read-only tools
src/lib/integrations/    Composio profiles, policies, recipes, and sync
src/lib/services/        Ingestion, parsing, storage, search, and graph adapters
src/worker/              BullMQ ingestion and graph workers
drizzle/                 Append-only SQL migrations
config/consts.json       All editable non-secret configuration
tests/                   Unit, contract, integration, and E2E coverage
evals/                   Promptfoo retrieval/grounding evaluation
docs/                    Architecture and operator documentation
```

## Working method

- Search with `rg`/`rg --files` before editing.
- Follow an existing abstraction before creating a new one.
- Prefer official SDKs over raw HTTP for Reducto, OpenRouter, Composio, and MCP.
- Keep normalized records and relationship edges provider-neutral.
- Make queue jobs idempotent, bounded, observable, and safe to retry.
- Add migrations; never rewrite a migration that may have run elsewhere.
- Preserve unrelated local changes. Never commit `.env`, runtime data, generated logs, traces, or provider payloads containing company content.
- Use `apply_patch` for hand-authored file edits.

## Verification ladder

Run the smallest relevant check while iterating, then the full local gate before handing off:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
git diff --check
```

For changes touching services, providers, graph lifecycle, or ingestion, also run the relevant live or evaluation checks:

```bash
bun run test:e2e:live
bun run eval:graph
bun run eval
bun run load:search
```

The live commands require the Compose stack and provider keys. If a required live check cannot run, state exactly which boundary remains unverified.

## Review checklist

- Is every new constant in `config/consts.json`?
- Is provider content bounded, validated, and redacted from logs?
- Can the operation safely retry after interruption?
- Are canonical records committed before derived indexes?
- Do deletion and supersession remove stale search/graph state?
- Are source and semantic edges visibly distinguishable?
- Does the UI have loading, empty, degraded, and error states?
- Does the fast path still avoid unnecessary model calls?
- Are tool schemas typed with Zod and read-only by construction?
- Did tests cover the failure mode, not only the happy path?

## Commit style

Use concise Conventional Commit messages: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, or `chore:`. Keep a commit focused on one coherent outcome.
