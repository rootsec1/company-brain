import { config } from "../src/lib/config";

type SearchMode = "lexical" | "hybrid";
type Sample = { elapsedMs: number; serverMs: number; cached: boolean; hits: number };

function argument(name: string) {
  const entry = process.argv.find((value) => value.startsWith(`--${name}=`));
  return entry?.slice(name.length + 3);
}

function positiveInteger(name: string, value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function search(baseUrl: string, query: string, mode: SearchMode, cacheBuster?: number): Promise<Sample> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      mode,
      limit: 10,
      ...(cacheBuster == null ? {} : { dateFrom: new Date(Date.UTC(2000, 0, 1) + cacheBuster * 1000).toISOString() })
    })
  });
  const elapsedMs = performance.now() - started;
  if (!response.ok) throw new Error(`${mode} search returned HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json() as { tookMs?: number; cached?: boolean; hits?: unknown[] };
  return {
    elapsedMs,
    serverMs: body.tookMs ?? elapsedMs,
    cached: Boolean(body.cached),
    hits: body.hits?.length ?? 0
  };
}

async function runPool<T>(count: number, concurrency: number, task: (index: number) => Promise<T>) {
  const results = new Array<T>(count);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < count) {
      const index = nextIndex++;
      results[index] = await task(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, worker));
  return results;
}

function report(label: string, samples: Sample[]) {
  const elapsed = samples.map((sample) => sample.elapsedMs);
  const server = samples.map((sample) => sample.serverMs);
  const cached = samples.filter((sample) => sample.cached).length;
  const result = {
    requests: samples.length,
    p50Ms: Math.round(percentile(elapsed, 0.5)),
    p95Ms: Math.round(percentile(elapsed, 0.95)),
    p99Ms: Math.round(percentile(elapsed, 0.99)),
    serverP95Ms: Math.round(percentile(server, 0.95)),
    cachedPercent: Math.round((cached / samples.length) * 100),
    emptyPercent: Math.round((samples.filter((sample) => sample.hits === 0).length / samples.length) * 100)
  };
  console.info(`${label}: ${JSON.stringify(result)}`);
  return result;
}

async function main() {
  const baseUrl = argument("base-url") ?? config.app.baseUrl;
  const requests = positiveInteger("requests", argument("requests"), config.performance.loadRequests);
  const concurrency = positiveInteger("concurrency", argument("concurrency"), config.performance.loadConcurrency);
  const queries = (argument("queries") ?? "launch,policy,security,roadmap,customer")
    .split(",").map((query) => query.trim()).filter(Boolean);
  if (!queries.length) throw new Error("At least one comma-separated --queries value is required");

  const health = await fetch(`${baseUrl}/api/health`);
  if (!health.ok && health.status !== 503) throw new Error(`Health endpoint returned HTTP ${health.status}`);

  const runNonce = Math.floor(Date.now() / 1000) % 1_000_000;
  const cachedQueries = queries;
  // Prime the exact repeated queries so the cached latency target is measured independently.
  await Promise.all(cachedQueries.map((query) => search(baseUrl, query, "lexical")));
  const cached = await runPool(requests, concurrency, (index) => search(baseUrl, cachedQueries[index % cachedQueries.length]!, "lexical"));
  const lexical = await runPool(requests, concurrency, (index) => search(baseUrl, queries[index % queries.length]!, "lexical", runNonce + index));
  const hybridCount = Math.min(requests, 100);
  const hybrid = await runPool(hybridCount, Math.min(concurrency, 8), (index) => search(baseUrl, queries[index % queries.length]!, "hybrid", runNonce + requests + index));

  const cachedResult = report("cached lexical", cached);
  const lexicalResult = report("uncached lexical", lexical);
  const hybridResult = report("hybrid (provider time included)", hybrid);
  const failures: string[] = [];
  if (cachedResult.p95Ms > config.performance.cachedTypeaheadP95Ms) failures.push(`cached lexical p95 ${cachedResult.p95Ms}ms > ${config.performance.cachedTypeaheadP95Ms}ms`);
  if (lexicalResult.p95Ms > config.performance.searchFirstPaintP95Ms) failures.push(`uncached lexical p95 ${lexicalResult.p95Ms}ms > ${config.performance.searchFirstPaintP95Ms}ms`);
  if (hybridResult.p95Ms > config.performance.hybridUpdateP95Ms) failures.push(`hybrid p95 ${hybridResult.p95Ms}ms > ${config.performance.hybridUpdateP95Ms}ms`);
  if (failures.length) throw new Error(`Performance thresholds failed: ${failures.join("; ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
