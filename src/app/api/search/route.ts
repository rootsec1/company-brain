import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { searchRequestSchema } from "@/lib/contracts";
import { searchKnowledge } from "@/lib/services/search";
import { getCachedJson, searchCacheKey, setCachedJson } from "@/lib/services/cache";
import { readJson } from "@/lib/http";

type SearchResult = { hits: Awaited<ReturnType<typeof searchKnowledge>>; mode: string };
const inFlightSearches = new Map<string, Promise<SearchResult>>();
const memorySearches = new Map<string, { value: SearchResult; expiresAt: number }>();
const memorySearchLimit = 500;

function getMemorySearch(key: string | null) {
  if (!key) return null;
  const cached = memorySearches.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) { memorySearches.delete(key); return null; }
  // Refresh insertion order so frequently used typeahead queries stay resident.
  memorySearches.delete(key);
  memorySearches.set(key, cached);
  return cached.value;
}

function setMemorySearch(key: string | null, value: SearchResult) {
  if (!key) return;
  memorySearches.set(key, { value, expiresAt: Date.now() + config.search.cacheSeconds * 1000 });
  while (memorySearches.size > memorySearchLimit) memorySearches.delete(memorySearches.keys().next().value!);
}

export async function POST(request: Request) {
  const parsed = searchRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid search request", issues: parsed.error.issues }, { status: 400 });
  const started = performance.now();
  const key = await searchCacheKey(parsed.data);
  const flightKey = key ?? JSON.stringify(parsed.data);
  const memory = getMemorySearch(key);
  if (memory) return NextResponse.json({ ...memory, tookMs: Math.round(performance.now() - started), cached: true });
  const cached = await getCachedJson<SearchResult>(key);
  if (cached) {
    setMemorySearch(key, cached);
    return NextResponse.json({ ...cached, tookMs: Math.round(performance.now() - started), cached: true });
  }
  let pending = inFlightSearches.get(flightKey);
  if (!pending) {
    pending = searchKnowledge(parsed.data).then((hits) => ({ hits, mode: parsed.data.mode }));
    inFlightSearches.set(flightKey, pending);
  }
  let result: SearchResult;
  try {
    result = await pending;
    setMemorySearch(key, result);
    await setCachedJson(key, result);
  } finally {
    if (inFlightSearches.get(flightKey) === pending) inFlightSearches.delete(flightKey);
  }
  return NextResponse.json({ ...result, tookMs: Math.round(performance.now() - started), cached: false });
}
