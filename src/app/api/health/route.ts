import { HeadBucketCommand } from "@aws-sdk/client-s3";
import IORedis from "ioredis";
import { NextResponse } from "next/server";
import { config, secrets } from "@/lib/config";
import { sql } from "@/lib/db";
import { validateOpenRouterModels } from "@/lib/services/openrouter";
import { getStorageClient } from "@/lib/services/storage";
import { validateReducto } from "@/lib/services/reducto";

type Check = { service: string; healthy: boolean; latencyMs: number; detail: string };
let modelCheck: { expires: number; result: Awaited<ReturnType<typeof validateOpenRouterModels>> } | undefined;
let reductoCheck: { expires: number; result: Awaited<ReturnType<typeof validateReducto>> } | undefined;

async function timed(service: string, check: () => Promise<string>): Promise<Check> {
  const start = performance.now();
  try {
    const detail = await Promise.race([
      check(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out")), config.services.healthCheckTimeoutMs))
    ]);
    return { service, healthy: true, latencyMs: Math.round(performance.now() - start), detail };
  } catch (error) {
    return { service, healthy: false, latencyMs: Math.round(performance.now() - start), detail: error instanceof Error ? error.message : "Unavailable" };
  }
}

async function fetchHealth(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(config.services.healthCheckTimeoutMs), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return "Online";
}

export async function GET() {
  const redis = new IORedis(config.services.valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3500 });
  const checks = await Promise.all([
    timed("postgres", async () => { await sql`select 1`; return "Canonical store online"; }),
    timed("typesense", () => fetchHealth(`${config.services.typesenseUrl}/health`)),
    timed("valkey", async () => { await redis.connect(); await redis.ping(); return "Queue and cache online"; }),
    timed("seaweedfs", async () => { await getStorageClient().send(new HeadBucketCommand({ Bucket: config.services.s3Bucket })); return "Object store online"; }),
    timed("lightrag", () => fetchHealth(`${config.services.lightRagUrl}/health`)),
    timed("openrouter", async () => {
      if (!secrets.openRouterApiKey) throw new Error("OPENROUTER_API_KEY missing");
      if (!modelCheck || modelCheck.expires < Date.now()) modelCheck = { expires: Date.now() + config.services.providerHealthCacheMs, result: await validateOpenRouterModels() };
      if (!modelCheck.result.healthy) throw new Error(modelCheck.result.detail);
      return modelCheck.result.detail;
    }),
    timed("reducto", async () => {
      if (!reductoCheck || reductoCheck.expires < Date.now()) reductoCheck = { expires: Date.now() + config.services.providerHealthCacheMs, result: await validateReducto() };
      if (!reductoCheck.result.healthy) throw new Error(reductoCheck.result.detail);
      return reductoCheck.result.detail;
    })
  ]).finally(() => redis.quit().catch(() => undefined));
  const critical = checks.filter((item) => ["postgres", "typesense", "valkey", "seaweedfs"].includes(item.service));
  const status = critical.every((item) => item.healthy) ? (checks.every((item) => item.healthy) ? "healthy" : "degraded") : "unhealthy";
  return NextResponse.json({ status, timestamp: new Date().toISOString(), services: checks }, { status: status === "unhealthy" ? 503 : 200 });
}
