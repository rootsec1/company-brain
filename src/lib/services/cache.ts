import { createHash } from "node:crypto";
import IORedis from "ioredis";
import { config } from "@/lib/config";

let cache: IORedis | undefined;
function client() {
  cache ??= new IORedis(config.services.valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: config.search.cacheTimeoutMs, commandTimeout: config.search.cacheTimeoutMs, enableOfflineQueue: false });
  return cache;
}
export async function searchCacheKey(value: unknown) {
  try {
    const redis = client();
    if (redis.status === "wait") await redis.connect();
    const generation = await redis.get("search:generation") ?? "0";
    return `search:${generation}:${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}`;
  } catch { return null; }
}
export async function getCachedJson<T>(key: string | null): Promise<T | null> {
  if (!key) return null;
  try { const value = await client().get(key); return value ? JSON.parse(value) as T : null; } catch { return null; }
}
export async function setCachedJson(key: string | null, value: unknown) {
  if (!key) return;
  try { await client().set(key, JSON.stringify(value), "EX", config.search.cacheSeconds); } catch { /* Search remains available without cache. */ }
}
export async function invalidateSearchCache() {
  try { const redis = client(); if (redis.status === "wait") await redis.connect(); await redis.incr("search:generation"); }
  catch { /* Ingestion correctness does not depend on cache availability. */ }
}
