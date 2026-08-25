import { createHash } from "node:crypto";
import { readFile, stat, unlink } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import { config, requireSecret, secrets } from "@/lib/config";
import { db } from "@/lib/db";
import { connections, sources, syncRuns } from "@/lib/db/schema";
import { enqueueIngestion } from "@/lib/api";
import { getSyncQueue } from "@/lib/queue";
import { getComposioClient, isReadOnlyToolSlug, selectReadTool } from "@/lib/integrations/composio";
import { normalizeComposioResponse, type ComposioToolResponse } from "@/lib/integrations/normalizers";
import { putObject } from "@/lib/services/storage";
import { deleteSourceRecord } from "@/lib/services/search";

type ImportRecipe = { toolSlug: string; version: string; schemaHash: string; instruction: string; downloadToolSlug?: string; downloadToolVersion?: string };
const adaptiveRecipeSchema = z.object({
  toolSlug: z.string().min(1),
  instruction: z.string().min(20).max(1200)
});

function schemaHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function discoverImportRecipe(toolkit: string, stored?: ImportRecipe | null): Promise<ImportRecipe> {
  const tools = await getComposioClient().tools.getRawComposioTools({ toolkits: [toolkit], limit: 100 });
  const preferred = config.integrationReadTools[toolkit.toLowerCase()] ?? [];
  const safeTools = tools.filter((tool) => isReadOnlyToolSlug(tool.slug));
  const selected = selectReadTool(safeTools, preferred);
  if (!selected) throw new Error(`${toolkit} has no safe enumerable read tools`);
  const download = safeTools.find((tool) => tool.slug.includes("_DOWNLOAD"));
  const currentSchemaHash = schemaHash(safeTools.map((tool) => ({
    slug: tool.slug,
    version: tool.version,
    input: tool.inputParameters,
    output: tool.outputParameters
  })));
  if (stored?.schemaHash === currentSchemaHash && safeTools.some((tool) => tool.slug === stored.toolSlug)) return stored;
  const fallback: ImportRecipe = {
    toolSlug: selected.slug,
    version: selected.version ?? selected.availableVersions?.[0] ?? "latest",
    schemaHash: currentSchemaHash,
    instruction: `Enumerate the most recently updated records available to this connection for read-only indexing. Return up to 100 records and include content, URLs, authors, timestamps, attachments, parent/thread identifiers, and the next cursor when supported.`,
    downloadToolSlug: download?.slug,
    downloadToolVersion: download?.version ?? download?.availableVersions?.[0]
  };
  if (preferred.length || !secrets.openRouterApiKey) return fallback;
  try {
    const openrouter = createOpenRouter({ apiKey: requireSecret("openRouterApiKey") });
    const candidates = safeTools.slice(0, 25).map((tool) => ({
      slug: tool.slug,
      description: tool.description,
      inputKeys: Object.keys((tool.inputParameters as Record<string, unknown> | undefined) ?? {}),
      outputKeys: Object.keys((tool.outputParameters as Record<string, unknown> | undefined) ?? {})
    }));
    const { output } = await generateText({
      model: openrouter(config.models.fast),
      output: Output.object({ schema: adaptiveRecipeSchema }),
      prompt: `Choose the safest read-only Composio tool for incrementally enumerating records from toolkit ${JSON.stringify(toolkit)}. The instruction must request bounded pages, content, URLs, authors, timestamps, attachments, relationships, deletion signals, and cursors when the schema supports them. Never request an external mutation. Choose only one supplied slug.\n\nCandidates:\n${JSON.stringify(candidates)}`,
      temperature: 0,
      maxOutputTokens: 700,
      timeout: 20_000
    });
    const chosen = output && safeTools.find((tool) => tool.slug === output.toolSlug);
    if (!output || !chosen) return fallback;
    return {
      ...fallback,
      toolSlug: chosen.slug,
      version: chosen.version ?? chosen.availableVersions?.[0] ?? "latest",
      instruction: output.instruction
    };
  } catch {
    return fallback;
  }
}

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, result);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, result);
  return result;
}

export function safeDownloadedPaths(value: unknown) {
  const root = resolve(config.integrations.downloadDirectory);
  return [...new Set(collectStrings(value).map((value) => resolve(value)).filter((value) => value.startsWith(`${root}${sep}`)))];
}

async function hydrateDownloadedAttachments(recipe: ImportRecipe, row: { connection: typeof connections.$inferSelect; source: typeof sources.$inferSelect }, records: ReturnType<typeof normalizeComposioResponse>) {
  if (!recipe.downloadToolSlug || !config.integrations.maxAttachmentDownloadsPerRun) return records;
  const candidates = records.filter((record) => !record.deletedAt && record.metadata.downloadRequired === true).slice(0, config.integrations.maxAttachmentDownloadsPerRun);
  for (const record of candidates) {
    try {
      const version = recipe.downloadToolVersion ?? "latest";
      const response = await getComposioClient().tools.execute(recipe.downloadToolSlug, {
        userId: config.app.workspaceId,
        connectedAccountId: row.connection.connectedAccountId ?? undefined,
        version,
        text: `Download the file with ID ${JSON.stringify(record.externalId)} named ${JSON.stringify(record.title)} for read-only indexing.`,
        dangerouslySkipVersionCheck: version === "latest"
      }) as ComposioToolResponse;
      const path = safeDownloadedPaths(response.data)[0];
      if (!path) continue;
      const info = await stat(path);
      if (!info.isFile() || info.size > config.ingestion.maxFileBytes) { await unlink(path).catch(() => undefined); continue; }
      const objectKey = `raw/integrations/${row.source.id}/${schemaHash(record.externalId)}/${basename(path)}`;
      await putObject(objectKey, await readFile(path), String(record.metadata.mimetype ?? record.metadata.mimeType ?? "application/octet-stream"));
      record.metadata = { ...record.metadata, rawObjectKey: objectKey, downloadedAt: new Date().toISOString() };
      await unlink(path).catch(() => undefined);
    } catch { /* Keep metadata-only context when a source cannot download an attachment. */ }
  }
  return records;
}

export async function enqueueConnectionSync(connectionId: string) {
  const connection = await db.query.connections.findFirst({ where: eq(connections.id, connectionId) });
  if (!connection) throw new Error("Connection not found");
  const [run] = await db.insert(syncRuns).values({ connectionId, status: "queued" }).returning();
  if (!run) throw new Error("Unable to create sync run");
  await getSyncQueue().add("sync", { type: "connection", connectionId, syncRunId: run.id }, { jobId: run.id });
  return run;
}

export function extractComposioCursors(response: ComposioToolResponse) {
  return {
    page: String(response.data.next_cursor ?? response.data.nextCursor ?? response.data.next_page_token ?? response.data.nextPageToken ?? "") || null,
    durable: String(response.data.new_start_page_token ?? response.data.newStartPageToken ?? response.data.sync_cursor ?? response.data.delta_link ?? "") || null
  };
}

export function advanceComposioCursor(current: string | null, response: ComposioToolResponse, isLastAllowedPage: boolean) {
  const { page, durable } = extractComposioCursors(response);
  return {
    nextPage: page,
    durable: durable ?? (isLastAllowedPage && page ? page : current)
  };
}

async function finishSyncRun(syncRunId: string) {
  const run = await db.query.syncRuns.findFirst({ where: eq(syncRuns.id, syncRunId) });
  if (!run || run.indexed + run.failed < run.scanned || ["completed", "partial", "failed"].includes(run.status)) return run;
  const status = run.failed ? "partial" : "completed";
  const [finished] = await db.update(syncRuns).set({ status, finishedAt: new Date(), updatedAt: new Date() }).where(eq(syncRuns.id, syncRunId)).returning();
  await db.update(connections).set({ status: "active", lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, run.connectionId));
  return finished;
}

export async function recordSyncIngestionOutcome(syncRunId: string | null | undefined, success: boolean) {
  if (!syncRunId) return;
  await db.update(syncRuns).set({
    indexed: success ? sql`${syncRuns.indexed} + 1` : syncRuns.indexed,
    failed: success ? syncRuns.failed : sql`${syncRuns.failed} + 1`,
    updatedAt: new Date()
  }).where(eq(syncRuns.id, syncRunId));
  await finishSyncRun(syncRunId);
}

export async function ensureSyncScheduler() {
  const every = config.integrations.pollingIntervalMinutes * 60_000;
  return getSyncQueue().upsertJobScheduler("integration-freshness-sweep", { every }, {
    name: "sync-sweep", data: { type: "sweep" }, opts: { attempts: 1 }
  });
}

export async function enqueueStaleConnectionSyncs() {
  const active = await db.select().from(connections).where(eq(connections.status, "active"));
  const cutoff = Date.now() - config.integrations.pollingIntervalMinutes * 60_000;
  let queued = 0;
  for (const connection of active) {
    if (connection.capabilities.imported === true) continue;
    if (connection.lastSyncedAt && connection.lastSyncedAt.getTime() > cutoff) continue;
    const running = await db.query.syncRuns.findFirst({
      where: and(eq(syncRuns.connectionId, connection.id), inArray(syncRuns.status, ["queued", "running", "indexing"]))
    });
    if (running) continue;
    await enqueueConnectionSync(connection.id);
    queued += 1;
  }
  return queued;
}

export async function enqueueTriggeredConnectionSync(connectedAccountIds: string[]) {
  const ids = [...new Set(connectedAccountIds.filter(Boolean))];
  if (!ids.length) return false;
  const connection = await db.query.connections.findFirst({ where: or(...ids.map((id) => eq(connections.connectedAccountId, id))) });
  if (!connection || connection.status !== "active") return false;
  const running = await db.query.syncRuns.findFirst({
    where: and(eq(syncRuns.connectionId, connection.id), inArray(syncRuns.status, ["queued", "running", "indexing"]))
  });
  if (running) return false;
  await enqueueConnectionSync(connection.id);
  return true;
}

export async function processConnectionSync(connectionId: string, syncRunId: string) {
  const [row] = await db.select({ connection: connections, source: sources }).from(connections).innerJoin(sources, eq(connections.sourceId, sources.id)).where(eq(connections.id, connectionId)).limit(1);
  if (!row) throw new Error("Connection not found");
  if (row.connection.capabilities.imported === true) {
    await db.update(syncRuns).set({ status: "completed", scanned: 0, indexed: 0, failed: 0, startedAt: new Date(), finishedAt: new Date(), updatedAt: new Date() }).where(eq(syncRuns.id, syncRunId));
    await db.update(connections).set({ status: "active", lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, connectionId));
    return { scanned: 0, enqueued: 0, failed: 0 };
  }
  await db.update(syncRuns).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(eq(syncRuns.id, syncRunId));
  try {
    const stored = row.connection.importRecipe as ImportRecipe | null;
    const recipe = await discoverImportRecipe(row.connection.toolkit, stored);
    if (!stored || recipe !== stored) await db.update(connections).set({ importRecipe: recipe, updatedAt: new Date() }).where(eq(connections.id, connectionId));
    const recordsById = new Map<string, ReturnType<typeof normalizeComposioResponse>[number]>();
    let cursor = row.connection.cursor;
    let finalCursor: string | null = cursor;
    for (let page = 0; page < config.integrations.maxPagesPerRun; page += 1) {
      const response = await getComposioClient().tools.execute(recipe.toolSlug, {
        userId: config.app.workspaceId,
        connectedAccountId: row.connection.connectedAccountId ?? undefined,
        version: recipe.version,
        text: `${recipe.instruction} Limit this page to ${config.integrations.recordsPerPage} records.${cursor ? ` Continue after cursor ${JSON.stringify(cursor)}.` : ""}`,
        dangerouslySkipVersionCheck: recipe.version === "latest"
      }) as ComposioToolResponse;
      for (const record of normalizeComposioResponse(row.connection.toolkit, row.source.id, response)) recordsById.set(record.externalId, record);
      const nextCursor = advanceComposioCursor(cursor, response, page + 1 === config.integrations.maxPagesPerRun);
      const next = nextCursor.nextPage;
      finalCursor = nextCursor.durable;
      if (!next || next === cursor) break;
      cursor = next;
    }
    const records = await hydrateDownloadedAttachments(recipe, row, [...recordsById.values()]);
    await db.update(syncRuns).set({ status: records.length ? "indexing" : "completed", scanned: records.length, finishedAt: records.length ? null : new Date(), updatedAt: new Date() }).where(eq(syncRuns.id, syncRunId));
    await db.update(connections).set({ cursor: finalCursor, status: records.length ? "syncing" : "active", ...(records.length ? {} : { lastSyncedAt: new Date() }), updatedAt: new Date() }).where(eq(connections.id, connectionId));
    let failed = 0;
    for (const record of records) {
      try {
        if (record.deletedAt) {
          await deleteSourceRecord(record.sourceId, record.externalId, record.deletedAt);
          await recordSyncIngestionOutcome(syncRunId, true);
        } else {
          await enqueueIngestion({ type: "record", record }, record.title, { syncRunId });
        }
      }
      catch { failed += 1; await recordSyncIngestionOutcome(syncRunId, false); }
    }
    return { scanned: records.length, enqueued: records.length - failed, failed };
  } catch (error) {
    await db.update(syncRuns).set({ status: "failed", error: error instanceof Error ? error.message : "Sync failed", finishedAt: new Date(), updatedAt: new Date() }).where(eq(syncRuns.id, syncRunId));
    throw error;
  }
}
