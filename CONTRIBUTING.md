# Contributing to Aperture

Thanks for helping build a faster, more trustworthy company brain. Small fixes, new source profiles, retrieval improvements, evaluation cases, documentation, and accessibility work are all welcome.

## Before you begin

- Read [`AGENTS.md`](AGENTS.md) for architecture invariants and the verification ladder.
- Search existing issues before opening a new one.
- For a large architectural change, open a discussion or design issue first so implementation effort is not wasted.
- Never include real company data, provider tokens, recorded OAuth payloads, or proprietary documents in fixtures.

## Local setup

The supported full-stack path is Docker Compose:

```bash
cp .env.example .env
# Fill OPENROUTER_API_KEY and REDUCTO_API_KEY.
docker compose up --build
```

For UI and unit-test iteration with local Bun:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run dev
```

Open `http://localhost:3000`. Composio is optional and degrades to a clear disabled state.

Documentation screenshots are generated from a deterministic fictional workspace, never from a connected source:

```bash
APERTURE_SCREENSHOT_DEMO=1 bun run audit:screenshots docs/assets
```

## Making a change

1. Keep the change scoped to one outcome.
2. Add or update tests at the closest level that proves the behavior.
3. Put new non-secret settings in `config/consts.json`.
4. Add a Drizzle migration for schema changes; do not edit historical migrations.
5. Update documentation when a public endpoint, configuration key, data contract, or operational behavior changes.
6. Run the verification ladder in `AGENTS.md`.

## Pull requests

A useful pull request explains the user-visible outcome, the system boundary that changed, the evidence that verifies it, and any known limitation. Screenshots are encouraged for UI work. Keep generated output and unrelated formatting out of the diff.

By participating, you agree to follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
