FROM oven/bun:1.4.0 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build
RUN bun build src/worker/index.ts --target=node --outfile=dist/worker.mjs
RUN bun build scripts/bootstrap.ts --target=node --outfile=dist/bootstrap.mjs
RUN bun build scripts/eval-seed.ts --target=node --outfile=dist/eval-seed.mjs

FROM node:26.8.1-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:26.8.1-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/worker.mjs ./worker.mjs
CMD ["node", "worker.mjs"]

FROM node:26.8.1-bookworm-slim AS bootstrap
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/bootstrap.mjs ./bootstrap.mjs
COPY --from=builder /app/drizzle ./drizzle
CMD ["node", "bootstrap.mjs"]

FROM node:26.8.1-bookworm-slim AS evaluation
WORKDIR /app
ENV NODE_ENV=production PROMPTFOO_DISABLE_TELEMETRY=1
RUN npm install --no-audit --no-fund --save-exact promptfoo@0.122.0
COPY --from=builder /app/dist/eval-seed.mjs ./eval-seed.mjs
COPY config ./config
COPY evals ./evals
CMD ["sh", "-c", "node eval-seed.mjs && ./node_modules/.bin/promptfoo eval -c evals/promptfooconfig.yaml"]
