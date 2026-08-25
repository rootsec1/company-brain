import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { documents, documentVersions } from "@/lib/db/schema";
import type { GraphPayload } from "@/lib/queue";
import { shouldEnrichGraph } from "@/lib/services/ingestion";

const headers = {
  "Content-Type": "application/json",
  "X-API-Key": config.services.lightRagApiKey
};

const pause = () => new Promise((resolve) => setTimeout(resolve, config.graph.pollIntervalMs));

async function waitForPipelineIdle(deadline = Date.now() + config.graph.processingTimeoutMs) {
  while (Date.now() < deadline) {
    const response = await fetch(`${config.services.lightRagUrl}/documents/pipeline_status`, {
      headers,
      signal: AbortSignal.timeout(config.graph.healthTimeoutMs)
    });
    if (!response.ok) throw new Error(`LightRAG pipeline status failed (${response.status})`);
    const state = await response.json() as { busy?: boolean; recovery_required?: boolean; recovery_message?: string };
    if (state.recovery_required) throw new Error(state.recovery_message ?? "LightRAG pipeline recovery is required");
    if (!state.busy) return;
    await pause();
  }
  throw new Error("LightRAG pipeline did not become idle before the configured deadline");
}

async function waitForTrack(trackId: string) {
  const deadline = Date.now() + config.graph.processingTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${config.services.lightRagUrl}/documents/track_status/${encodeURIComponent(trackId)}`, {
      headers,
      signal: AbortSignal.timeout(config.graph.healthTimeoutMs)
    });
    if (!response.ok) throw new Error(`LightRAG track status failed (${response.status})`);
    const state = await response.json() as { documents?: Array<{ status?: string; error_msg?: string }> };
    const statuses = (state.documents ?? []).map((document) => String(document.status ?? "").toLowerCase());
    if (statuses.some((status) => status === "failed")) {
      const message = state.documents?.find((document) => String(document.status).toLowerCase() === "failed")?.error_msg ?? "LightRAG graph extraction failed";
      const duplicate = message.match(/Identical content already exists under another filename\. Original doc_id: (doc-[a-f0-9]+)/i)?.[1];
      if (duplicate) return duplicate;
      throw new Error(message);
    }
    if (statuses.length && statuses.every((status) => status === "processed")) return null;
    await pause();
  }
  throw new Error("LightRAG graph extraction did not finish before the configured deadline");
}

export async function insertIntoGraph(documentId: string, title: string, markdown: string) {
  if (!config.features.semanticGraph) return { status: "disabled" };
  const response = await fetch(`${config.services.lightRagUrl}/documents/text`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: markdown,
      file_source: `brain://${documentId}/${encodeURIComponent(lightRagFileName(documentId, title))}`,
      chunking: {
        strategy: "fixed_token",
        params: {
          chunk_token_size: config.ingestion.chunkSize,
          chunk_overlap_token_size: config.ingestion.chunkOverlap
        }
      }
    }),
    signal: AbortSignal.timeout(config.graph.insertTimeoutMs)
  });
  if (!response.ok) throw new Error(`LightRAG insert failed (${response.status})`);
  const result = await response.json() as { status: string; track_id?: string };
  const duplicateDocumentId = result.track_id ? await waitForTrack(result.track_id) : null;
  if (duplicateDocumentId) return { ...result, status: "duplicate", duplicateDocumentId, contentHash: graphContentHash(markdown) };
  return { ...result, documentId: lightRagDocumentId(documentId, title), contentHash: graphContentHash(markdown) };
}

export function lightRagFileName(documentId: string, title: string) {
  return `${documentId}-${title}`;
}

export function lightRagDocumentId(documentId: string, title: string) {
  return `doc-${createHash("md5").update(encodeURIComponent(lightRagFileName(documentId, title))).digest("hex")}`;
}

export function graphContentHash(markdown: string) {
  return createHash("sha256").update(markdown.trim()).digest("hex");
}

export function canReuseGraphDocument(previousGraphId: string | undefined, previousContentHash: string | undefined, documentId: string, title: string, markdown: string) {
  return Boolean(
    previousGraphId
    && previousGraphId === lightRagDocumentId(documentId, title)
    && previousContentHash === graphContentHash(markdown)
  );
}

export async function deleteFromGraph(documentId: string) {
  if (!config.features.semanticGraph) return { status: "disabled" };
  const deadline = Date.now() + config.graph.processingTimeoutMs;
  while (Date.now() < deadline) {
    await waitForPipelineIdle(deadline);
    const response = await fetch(`${config.services.lightRagUrl}/documents/delete_document`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ doc_ids: [documentId], delete_file: true, delete_llm_cache: false }),
      signal: AbortSignal.timeout(config.graph.deleteTimeoutMs)
    });
    if (!response.ok) throw new Error(`LightRAG delete failed (${response.status})`);
    const result = await response.json() as { status: string; message?: string };
    if (result.status === "busy") { await pause(); continue; }
    await waitForPipelineIdle(deadline);
    return result;
  }
  throw new Error("LightRAG delete did not finish before the configured deadline");
}

export async function processGraphEnrichment(payload: GraphPayload) {
  const [document, version] = await Promise.all([
    db.query.documents.findFirst({ where: and(eq(documents.id, payload.documentId), isNull(documents.deletedAt)) }),
    db.query.documentVersions.findFirst({ where: eq(documentVersions.id, payload.versionId) })
  ]);
  if (!document || !version || version.documentId !== document.id || version.version !== document.currentVersion) {
    if (payload.previousGraphId) await deleteFromGraph(payload.previousGraphId).catch(() => undefined);
    return { status: "stale" };
  }
  if (!shouldEnrichGraph(document, version.markdown)) {
    if (payload.previousGraphId) await deleteFromGraph(payload.previousGraphId).catch(() => undefined);
    await db.update(documents).set({
      metadata: { ...document.metadata, graphStatus: "skipped: below semantic threshold" },
      updatedAt: new Date()
    }).where(eq(documents.id, document.id));
    return { status: "skipped" };
  }
  if (canReuseGraphDocument(payload.previousGraphId, payload.previousGraphContentHash, document.id, document.title, version.markdown)) {
    await db.update(documents).set({
      metadata: { ...document.metadata, graphStatus: "reused", graphDocumentId: payload.previousGraphId, graphContentHash: payload.previousGraphContentHash },
      updatedAt: new Date()
    }).where(eq(documents.id, document.id));
    return { status: "reused", documentId: payload.previousGraphId };
  }
  await deleteFromGraph(payload.previousGraphId ?? lightRagDocumentId(document.id, document.title)).catch(() => undefined);
  try {
    const result = await insertIntoGraph(document.id, document.title, version.markdown);
    const latest = await db.query.documents.findFirst({ where: and(eq(documents.id, document.id), isNull(documents.deletedAt)) });
    if (!latest || latest.currentVersion !== version.version) {
      if ("documentId" in result) await deleteFromGraph(result.documentId).catch(() => undefined);
      return { status: "stale-after-insert" };
    }
    await db.update(documents).set({
      metadata: { ...latest.metadata, graphStatus: result.status, ...("documentId" in result ? { graphDocumentId: result.documentId, graphContentHash: result.contentHash } : {}) },
      updatedAt: new Date()
    }).where(eq(documents.id, document.id));
    return result;
  } catch (error) {
    const latest = await db.query.documents.findFirst({ where: eq(documents.id, document.id) });
    if (latest?.currentVersion === version.version) await db.update(documents).set({
      metadata: { ...latest.metadata, graphStatus: `degraded: ${error instanceof Error ? error.message : "unavailable"}` },
      updatedAt: new Date()
    }).where(eq(documents.id, document.id));
    throw error;
  }
}

export async function getGraphContext(query: string, mode: "local" | "global" | "mix" = "mix") {
  if (!config.features.semanticGraph) return { response: "", references: [] };
  const response = await fetch(`${config.services.lightRagUrl}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      mode,
      only_need_context: true,
      include_references: true,
      include_chunk_content: true,
      top_k: 12,
      chunk_top_k: 12,
      max_total_tokens: 8000
    }),
    signal: AbortSignal.timeout(config.graph.queryTimeoutMs)
  });
  if (!response.ok) throw new Error(`LightRAG query failed (${response.status})`);
  return boundGraphContext(await response.json());
}

type LightRagReference = Record<string, unknown>;

function firstString(record: LightRagReference, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function referenceContent(reference: LightRagReference) {
  const value = reference.content ?? reference.text ?? reference.chunk_content;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("\n");
  return "";
}

/**
 * LightRAG references can contain complete source chunks. Returning them verbatim
 * makes one graph tool call large enough to exhaust the final synthesis context.
 * Keep the semantic response and compact provenance, never full source objects.
 */
export function boundGraphContext(
  value: unknown,
  limits = {
    maxContextCharacters: config.graph.maxContextCharacters,
    maxReferences: config.graph.maxReferences,
    maxReferenceCharacters: config.graph.maxReferenceCharacters
  }
) {
  const result = value && typeof value === "object" ? value as LightRagReference : {};
  const response = typeof result.response === "string" ? result.response.slice(0, limits.maxContextCharacters) : "";
  const references = Array.isArray(result.references)
    ? result.references.slice(0, limits.maxReferences).map((raw, index) => {
        const reference = raw && typeof raw === "object" ? raw as LightRagReference : {};
        return {
          referenceId: firstString(reference, ["reference_id", "referenceId", "id"]) ?? String(index + 1),
          source: firstString(reference, ["file_path", "file_source", "source", "title"]),
          content: referenceContent(reference).slice(0, limits.maxReferenceCharacters)
        };
      })
    : [];
  return { response, references };
}

type LightRagGraph = {
  nodes: Array<{ id: string; labels?: string[]; properties?: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; type?: string; properties?: Record<string, unknown> }>;
};

export function normalizeSemanticGraph(graph: LightRagGraph) {
  return {
    nodes: graph.nodes.map((node) => ({
      id: `semantic:${node.id}`,
      title: String(node.properties?.entity_id ?? node.properties?.name ?? node.labels?.[0] ?? node.id),
      kind: String(node.labels?.[0] ?? "entity"),
      provenance: "semantic" as const
    })),
    edges: graph.edges.map((edge) => ({
      id: `semantic:${edge.id}`,
      source: `semantic:${edge.source}`,
      target: `semantic:${edge.target}`,
      label: String(edge.properties?.keywords ?? edge.type ?? "related"),
      provenance: "semantic" as const
    }))
  };
}

export async function getSemanticGraph() {
  if (!config.features.semanticGraph) return { nodes: [], edges: [], available: false };
  const labelsResponse = await fetch(`${config.services.lightRagUrl}/graph/label/popular?limit=${config.graph.popularLabels}`, { headers, signal: AbortSignal.timeout(config.graph.visualizationTimeoutMs) });
  if (!labelsResponse.ok) throw new Error(`LightRAG labels failed (${labelsResponse.status})`);
  const labels = await labelsResponse.json() as string[];
  if (!labels.length) return { nodes: [], edges: [], available: true };
  const perLabel = Math.max(8, Math.ceil(config.graph.maxSemanticNodes / labels.length));
  const graphs = await Promise.all(labels.map(async (label) => {
    const params = new URLSearchParams({ label, max_depth: String(config.graph.semanticDepth), max_nodes: String(perLabel) });
    const response = await fetch(`${config.services.lightRagUrl}/graphs?${params}`, { headers, signal: AbortSignal.timeout(config.graph.visualizationTimeoutMs) });
    if (!response.ok) throw new Error(`LightRAG graph failed (${response.status})`);
    return normalizeSemanticGraph(await response.json() as LightRagGraph);
  }));
  const nodes = [...new Map(graphs.flatMap((graph) => graph.nodes).map((node) => [node.id, node])).values()].slice(0, config.graph.maxSemanticNodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...new Map(graphs.flatMap((graph) => graph.edges).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).map((edge) => [edge.id, edge])).values()];
  return { nodes, edges, available: true };
}

export async function isLightRagHealthy() {
  try {
    const response = await fetch(`${config.services.lightRagUrl}/health`, { signal: AbortSignal.timeout(config.graph.healthTimeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}
