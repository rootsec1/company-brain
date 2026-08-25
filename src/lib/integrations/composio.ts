import { Composio, type IncomingTriggerPayload } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { and, eq } from "drizzle-orm";
import { config, secrets } from "@/lib/config";
import { db } from "@/lib/db";
import { connections, sources } from "@/lib/db/schema";
import { normalizeComposioResponse, type ComposioToolResponse } from "@/lib/integrations/normalizers";

let client: Composio<VercelProvider> | undefined;
let toolkitCatalogCache: { expiresAt: number; value: Awaited<ReturnType<typeof fetchToolkits>> } | undefined;

export const mutationVerbs = [
  "CREATE", "UPDATE", "DELETE", "SEND", "POST", "PUT", "PATCH", "REMOVE", "ADD", "INVITE", "COMMENT", "REPLY", "REACT", "UPLOAD", "MOVE", "ARCHIVE"
];
export const readVerbs = ["SEARCH", "LIST", "GET", "FIND", "FETCH", "READ", "QUERY", "DOWNLOAD"];

export function isReadOnlyToolSlug(slug: string) {
  const upper = slug.toUpperCase();
  return readVerbs.some((verb) => upper.includes(`_${verb}`))
    && !mutationVerbs.some((verb) => upper.includes(`_${verb}`));
}

export function selectReadTool<T extends { slug: string }>(tools: T[], preferred: string[] = [], purpose: "enumerate" | "search" = "enumerate") {
  const verbs = purpose === "search" ? ["SEARCH", "FIND", "QUERY", "LIST", "GET"] : ["SEARCH", "LIST", "FETCH", "GET"];
  const score = (slug: string) => {
    const preferredIndex = preferred.indexOf(slug);
    if (preferredIndex >= 0) return 10_000 - preferredIndex;
    return verbs.reduce((total, verb, index) => total + (slug.includes(`_${verb}`) ? 100 - index * 10 : 0), 0);
  };
  return tools.filter((tool) => isReadOnlyToolSlug(tool.slug)).sort((a, b) => score(b.slug) - score(a.slug))[0];
}

export function composioEnabled() {
  return Boolean(config.features.composioIntegrations && secrets.composioApiKey);
}

export function getComposioClient() {
  if (!composioEnabled()) throw new Error("COMPOSIO_API_KEY is not configured");
  client ??= new Composio({
    apiKey: secrets.composioApiKey,
    provider: new VercelProvider({ strict: true }),
    allowTracking: false,
    dangerouslyAllowAutoUploadDownloadFiles: true,
    fileDownloadDir: config.integrations.downloadDirectory
  });
  return client;
}

export async function subscribeToComposioTriggers(onTrigger: (payload: IncomingTriggerPayload) => Promise<void>) {
  if (!composioEnabled()) return false;
  await getComposioClient().triggers.subscribe((payload) => {
    if (payload.userId !== config.app.workspaceId) return;
    void onTrigger(payload).catch((error) => console.error("[composio] trigger sync failed", error));
  }, { userId: config.app.workspaceId });
  return true;
}

export async function unsubscribeFromComposioTriggers() {
  if (!composioEnabled()) return;
  await getComposioClient().triggers.unsubscribe();
}

async function fetchToolkits(limit: number) {
  const result = await getComposioClient().toolkits.get({ limit, sortBy: "usage", managedBy: "all" });
  return result.map((toolkit) => ({
    slug: toolkit.slug,
    name: toolkit.name,
    description: toolkit.meta.description,
    logo: toolkit.meta.logo,
    toolsCount: toolkit.meta.toolsCount ?? 0,
    categories: toolkit.meta.categories ?? [],
    optimized: config.integrationProfiles.includes(toolkit.slug.toLowerCase()),
    noAuth: toolkit.noAuth ?? false
  }));
}

export async function listToolkits(limit = config.integrations.catalogLimit) {
  if (!composioEnabled()) return [];
  if (toolkitCatalogCache && toolkitCatalogCache.expiresAt > Date.now()) return toolkitCatalogCache.value.slice(0, limit);
  const value = await fetchToolkits(limit);
  toolkitCatalogCache = { expiresAt: Date.now() + config.integrations.catalogCacheMinutes * 60_000, value };
  return value;
}

export async function authorizeToolkit(toolkit: string) {
  const composio = getComposioClient();
  const metadata = await composio.toolkits.get(toolkit);
  const existingSource = await db.query.sources.findFirst({
    where: and(eq(sources.workspaceId, config.app.workspaceId), eq(sources.slug, toolkit))
  });
  const [source] = existingSource ? [existingSource] : await db.insert(sources).values({
    workspaceId: config.app.workspaceId,
    slug: toolkit,
    name: metadata.name,
    kind: "composio",
    iconUrl: metadata.meta.logo,
    status: "connecting",
    metadata: { optimized: config.integrationProfiles.includes(toolkit.toLowerCase()) }
  }).returning();
  if (!source) throw new Error("Unable to persist integration source");
  const authorization = await composio.toolkits.authorize(config.app.workspaceId, toolkit);
  await db.update(sources).set({ status: "connecting", updatedAt: new Date() }).where(eq(sources.id, source.id));
  const values = {
    connectedAccountId: authorization.id,
    status: authorization.status?.toLowerCase() ?? "pending",
    capabilities: {
      canEnumerate: config.integrationProfiles.includes(toolkit.toLowerCase()),
      canDeltaSync: false,
      canLiveSearch: true,
      attachmentSupport: config.integrationProfiles.includes(toolkit.toLowerCase())
    },
    updatedAt: new Date()
  };
  const existingConnection = await db.query.connections.findFirst({ where: eq(connections.sourceId, source.id) });
  const [connection] = existingConnection
    ? await db.update(connections).set(values).where(eq(connections.id, existingConnection.id)).returning()
    : await db.insert(connections).values({ sourceId: source.id, toolkit, ...values }).returning();
  return { connection, redirectUrl: authorization.redirectUrl, status: authorization.status };
}

export async function listConnections() {
  const rows = await db.select({
    id: connections.id,
    toolkit: connections.toolkit,
    status: connections.status,
    connectedAccountId: connections.connectedAccountId,
    lastSyncedAt: connections.lastSyncedAt,
    createdAt: connections.createdAt,
    sourceId: sources.id,
    name: sources.name,
    iconUrl: sources.iconUrl,
    capabilities: connections.capabilities
  }).from(connections).innerJoin(sources, eq(connections.sourceId, sources.id));
  if (!composioEnabled()) return rows;
  await Promise.all(rows.filter((item) => item.status !== "active" && item.connectedAccountId).map(async (item) => {
    try {
      const remote = await getComposioClient().connectedAccounts.get(item.connectedAccountId!);
      const nextStatus = String(remote.status).toLowerCase();
      if (nextStatus !== item.status) {
        item.status = nextStatus;
        await db.update(connections).set({ status: nextStatus, updatedAt: new Date() }).where(eq(connections.id, item.id));
        await db.update(sources).set({ status: nextStatus === "active" ? "ready" : nextStatus, updatedAt: new Date() }).where(eq(sources.id, item.sourceId));
      }
    } catch { /* Keep the last known state when Composio is temporarily unavailable. */ }
  }));
  return rows;
}

export async function removeConnection(id: string) {
  const existing = await db.query.connections.findFirst({ where: eq(connections.id, id) });
  if (existing?.connectedAccountId && composioEnabled()) {
    await getComposioClient().connectedAccounts.delete(existing.connectedAccountId).catch(() => undefined);
  }
  const [removed] = await db.delete(connections).where(eq(connections.id, id)).returning();
  if (removed) await db.update(sources).set({ status: "disconnected", updatedAt: new Date() }).where(eq(sources.id, removed.sourceId));
  return removed ?? null;
}

export async function liveSourceSearch(query: string) {
  if (!config.features.liveSourceSearch || !composioEnabled()) return {
    available: false,
    message: "Live integrations are unavailable until COMPOSIO_API_KEY is configured.",
    query
  };
  const connected = (await listConnections()).filter((item) => item.status === "active").slice(0, config.integrations.liveSearchConnections);
  if (!connected.length) return { available: false, query, connectedSources: [], results: [], message: "No active Composio sources are connected yet." };
  const settled = await Promise.allSettled(connected.map(async (item) => {
    const tools = await getComposioClient().tools.getRawComposioTools({ toolkits: [item.toolkit], limit: 100 });
    const selected = selectReadTool(tools, [], "search");
    if (!selected) throw new Error(`${item.name} has no safe search tool`);
    const version = selected.version ?? selected.availableVersions?.[0] ?? "latest";
    const response = await getComposioClient().tools.execute(selected.slug, {
      userId: config.app.workspaceId,
      connectedAccountId: item.connectedAccountId ?? undefined,
      version,
      text: `Search read-only for ${JSON.stringify(query.slice(0, 500))}. Return the ${config.integrations.liveSearchResultsPerConnection} most relevant records with content, URL, author, and timestamp.`,
      dangerouslySkipVersionCheck: version === "latest"
    }) as ComposioToolResponse;
    return normalizeComposioResponse(item.toolkit, item.sourceId, response).slice(0, config.integrations.liveSearchResultsPerConnection).map((record) => ({
      externalId: record.externalId, title: record.title, snippet: record.bodyMarkdown.slice(0, 1200), sourceUrl: record.sourceUrl,
      sourceId: item.sourceId, sourceName: item.name, kind: record.kind, authors: record.authors, updatedAt: record.updatedAt
    }));
  }));
  const results = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const warnings = settled.flatMap((result, index) => result.status === "rejected" ? [`${connected[index]?.name ?? "Source"}: ${result.reason instanceof Error ? result.reason.message : "search failed"}`] : []);
  return {
    available: true,
    query,
    connectedSources: connected.map((item) => item.name),
    results,
    warnings,
    message: results.length ? `Found ${results.length} live results.` : "No live results matched the query."
  };
}
