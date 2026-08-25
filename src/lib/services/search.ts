import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { config, secrets } from "@/lib/config";
import type { SearchHit, SearchRequest } from "@/lib/contracts";
import { db } from "@/lib/db";
import { chunks, documents, documentVersions, relationshipEdges, sources } from "@/lib/db/schema";
import { deleteFromGraph } from "@/lib/services/lightrag";
import { embedTexts, rerankTexts } from "@/lib/services/openrouter";
import { invalidateSearchCache } from "@/lib/services/cache";
import { chunkCollection, deleteDocumentChunks, getTypesenseClient, type TypesenseChunk } from "@/lib/services/typesense";

type TypesenseHit = {
  document: TypesenseChunk;
  text_match?: number;
  vector_distance?: number;
  hybrid_search_info?: { rank_fusion_score?: number };
  highlights?: Array<{ field: string; snippet?: string; value?: string }>;
};

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Provider deadline exceeded")), timeoutMs);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function filterValue(value: string) {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function createFilter(request: SearchRequest) {
  const filters: string[] = [];
  if (request.sourceIds?.length) filters.push(`sourceId:=[${request.sourceIds.map(filterValue).join(",")}]`);
  if (request.kinds?.length) filters.push(`kind:=[${request.kinds.map(filterValue).join(",")}]`);
  if (request.authors?.length) filters.push(`authors:=[${request.authors.map(filterValue).join(",")}]`);
  if (request.dateFrom) filters.push(`updatedAt:>=${Math.floor(request.dateFrom.getTime() / 1000)}`);
  if (request.dateTo) filters.push(`updatedAt:<=${Math.floor(request.dateTo.getTime() / 1000)}`);
  return filters.join(" && ");
}

function toSearchHit(hit: TypesenseHit): SearchHit {
  const document = hit.document;
  const highlighted = hit.highlights?.find((entry) => entry.field === "content")?.snippet;
  const score = hit.hybrid_search_info?.rank_fusion_score
    ?? (hit.vector_distance == null ? Number(hit.text_match ?? 0) : 1 - hit.vector_distance);
  return {
    id: document.id,
    documentId: document.documentId,
    title: document.title,
    snippet: highlighted ?? document.content.slice(0, 360),
    content: document.content,
    kind: document.kind,
    sourceId: document.sourceId,
    sourceName: document.sourceName,
    sourceUrl: document.sourceUrl,
    authors: document.authors ?? [],
    updatedAt: new Date(document.updatedAt * 1000).toISOString(),
    score,
    citation: {
      documentId: document.documentId,
      chunkId: document.id,
      title: document.title,
      sourceUrl: document.sourceUrl,
      page: document.page
    }
  };
}

export async function searchKnowledge(request: SearchRequest): Promise<SearchHit[]> {
  const filterBy = createFilter(request);
  const params: Record<string, string | number | boolean> = {
    q: request.query,
    query_by: "title,content",
    query_by_weights: "3,1",
    per_page: request.mode === "agent" ? config.search.hybridCandidateLimit : Math.max(request.limit, config.search.lexicalLimit),
    highlight_full_fields: "content,title",
    highlight_affix_num_tokens: 24,
    prioritize_exact_match: true,
    drop_tokens_threshold: 0,
    typo_tokens_threshold: 1,
    exclude_fields: "embedding"
  };
  if (filterBy) params.filter_by = filterBy;
  if (request.mode !== "lexical" && secrets.openRouterApiKey) {
    try {
      const embeddingTimeout = request.mode === "agent" ? config.search.agentEmbeddingTimeoutMs : config.search.uiEmbeddingTimeoutMs;
      const [queryVector] = await withinDeadline(
        embedTexts([request.query], "query", embeddingTimeout),
        embeddingTimeout
      );
      params.vector_query = `embedding:([${queryVector.join(",")}],k:${config.search.hybridCandidateLimit},alpha:${config.search.semanticWeight})`;
      params.rerank_hybrid_matches = true;
    } catch {
      // The lexical request remains useful when an upstream embedding provider misses the interactive deadline.
    }
  }
  // Vector payloads are too large for Typesense's GET query-string limit at 1,024 dimensions.
  // Multi-search sends the same query as a POST body and also keeps lexical requests on one code path.
  const multi = await getTypesenseClient().multiSearch.perform({
    searches: [{ collection: chunkCollection, ...params }]
  } as never) as unknown as { results: Array<{ hits?: unknown[] }> };
  const response = multi.results[0] ?? { hits: [] };
  let hits = ((response.hits ?? []) as unknown as TypesenseHit[]).map(toSearchHit);
  if (request.mode !== "lexical" && hits.length > 1 && secrets.openRouterApiKey) {
    try {
      const rerankTimeout = request.mode === "agent" ? config.search.agentRerankTimeoutMs : config.search.uiRerankTimeoutMs;
      const ranking = await withinDeadline(
        rerankTexts(request.query, hits.map((hit) => `${hit.title}\n${hit.content}`), request.limit, rerankTimeout),
        rerankTimeout
      );
      hits = ranking.map((entry) => ({ ...hits[entry.index], score: entry.relevanceScore })).filter(Boolean);
    } catch {
      // The fused Typesense order remains a high-quality degraded path.
    }
  }
  if (request.mode !== "agent") hits = [...new Map(hits.map((hit) => [hit.documentId, hit])).values()];
  return hits.slice(0, request.limit);
}

export async function getDocument(documentId: string, requestedVersion?: number) {
  const [row] = await db.select({ document: documents, source: sources })
    .from(documents)
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (!row) return null;
  const document = { ...row.document, source: row.source };
  const selectedVersion = requestedVersion ?? document.currentVersion;
  const [version, versions, related] = await Promise.all([
    db.query.documentVersions.findFirst({
      where: and(eq(documentVersions.documentId, documentId), eq(documentVersions.version, selectedVersion))
    }),
    db.select({
      version: documentVersions.version,
      parser: documentVersions.parser,
      createdAt: documentVersions.createdAt,
      metadata: documentVersions.metadata
    }).from(documentVersions).where(eq(documentVersions.documentId, documentId)).orderBy(desc(documentVersions.version)),
    findRelated(documentId)
  ]);
  if (!version) return null;
  return {
    ...document,
    markdown: version.markdown,
    version: version.version,
    currentVersion: document.currentVersion,
    viewedVersionCreatedAt: version.createdAt,
    versions,
    related
  };
}

export async function deleteDocument(documentId: string) {
  const current = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!current || current.deletedAt) return false;
  await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, documentId));
  await deleteDocumentChunks(documentId);
  await invalidateSearchCache();
  const graphDocumentId = current.metadata?.graphDocumentId;
  if (typeof graphDocumentId === "string") await deleteFromGraph(graphDocumentId).catch(() => undefined);
  return true;
}

export async function deleteSourceRecord(sourceId: string, externalId: string, deletedAt = new Date()) {
  const current = await db.query.documents.findFirst({ where: and(eq(documents.sourceId, sourceId), eq(documents.externalId, externalId)) });
  if (!current || current.deletedAt) return true;
  await db.update(documents).set({
    deletedAt,
    metadata: { ...current.metadata, tombstone: { sourceId, externalId, deletedAt: deletedAt.toISOString() } },
    updatedAt: new Date()
  }).where(eq(documents.id, current.id));
  await deleteDocumentChunks(current.id);
  await invalidateSearchCache();
  const graphDocumentId = current.metadata?.graphDocumentId;
  if (typeof graphDocumentId === "string") await deleteFromGraph(graphDocumentId).catch(() => undefined);
  return true;
}

export async function findRelated(documentId: string) {
  const edges = await db.select().from(relationshipEdges).where(or(
    eq(relationshipEdges.fromDocumentId, documentId),
    eq(relationshipEdges.toDocumentId, documentId)
  )).limit(40);
  const ids = [...new Set(edges.flatMap((edge) => [edge.fromDocumentId, edge.toDocumentId]).filter((id) => id !== documentId))];
  if (!ids.length) return [];
  const relatedDocuments = await db.select({
    id: documents.id,
    title: documents.title,
    kind: documents.kind,
    sourceUrl: documents.sourceUrl,
    updatedAt: documents.updatedAt
  }).from(documents).where(and(inArray(documents.id, ids), isNull(documents.deletedAt)));
  return relatedDocuments.map((document) => ({
    ...document,
    edge: edges.find((edge) => edge.fromDocumentId === document.id || edge.toDocumentId === document.id)
  }));
}

export async function getRelationshipGraph(documentId?: string) {
  let edgeRows: Array<typeof relationshipEdges.$inferSelect>;
  if (documentId) {
    const found = new Map<string, typeof relationshipEdges.$inferSelect>();
    const visited = new Set([documentId]);
    let frontier = [documentId];
    for (let depth = 0; depth < config.search.relationshipDepth && frontier.length && found.size < 150; depth += 1) {
      const rows = await db.select().from(relationshipEdges).where(or(
        inArray(relationshipEdges.fromDocumentId, frontier),
        inArray(relationshipEdges.toDocumentId, frontier)
      )).limit(150 - found.size);
      const next: string[] = [];
      for (const edge of rows) {
        found.set(edge.id, edge);
        for (const id of [edge.fromDocumentId, edge.toDocumentId]) {
          if (!visited.has(id)) { visited.add(id); next.push(id); }
        }
      }
      frontier = next;
    }
    edgeRows = [...found.values()];
  } else {
    edgeRows = await db.select().from(relationshipEdges).orderBy(desc(relationshipEdges.createdAt)).limit(150);
  }
  let ids = [...new Set(edgeRows.flatMap((edge) => [edge.fromDocumentId, edge.toDocumentId]))];
  if (documentId && !ids.includes(documentId)) ids = [documentId, ...ids];
  if (!ids.length) {
    const recent = await db.select({ id: documents.id }).from(documents).where(isNull(documents.deletedAt)).orderBy(desc(documents.updatedAt)).limit(24);
    ids = recent.map((document) => document.id);
  }
  const nodeRows = ids.length
    ? await db.select({
        id: documents.id,
        title: documents.title,
        kind: documents.kind,
        sourceId: documents.sourceId,
        updatedAt: documents.updatedAt
      }).from(documents).where(and(inArray(documents.id, ids), isNull(documents.deletedAt)))
    : [];
  const visibleIds = new Set(nodeRows.map((node) => node.id));
  return {
    nodes: nodeRows.map((node) => ({ ...node, provenance: "source" as const })),
    edges: edgeRows.filter((edge) => visibleIds.has(edge.fromDocumentId) && visibleIds.has(edge.toDocumentId)).map((edge) => ({
      id: edge.id,
      source: edge.fromDocumentId,
      target: edge.toDocumentId,
      type: edge.type,
      label: edge.label ?? edge.type,
      provenance: edge.provenance,
      confidence: edge.confidence
    }))
  };
}

export async function getDashboardData() {
  const [documentCount, chunkCount, sourceRows, recentDocuments] = await Promise.all([
    db.$count(documents, isNull(documents.deletedAt)),
    db.select({ value: count() }).from(chunks)
      .innerJoin(documentVersions, eq(chunks.versionId, documentVersions.id))
      .innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(and(isNull(documents.deletedAt), eq(documentVersions.version, documents.currentVersion)))
      .then((rows) => rows[0]?.value ?? 0),
    db.select().from(sources).orderBy(sources.name),
    db.select({
      id: documents.id,
      title: documents.title,
      kind: documents.kind,
      updatedAt: documents.updatedAt,
      authors: documents.authors
    }).from(documents).where(isNull(documents.deletedAt)).orderBy(desc(documents.updatedAt)).limit(8)
  ]);
  return { documentCount, chunkCount, sources: sourceRows, recentDocuments };
}
