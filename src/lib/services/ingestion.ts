import { createHash, randomUUID } from "node:crypto";
import Reducto from "reductoai";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { config } from "@/lib/config";
import { normalizedRecordSchema, type NormalizedRecord, type RelationshipEdge } from "@/lib/contracts";
import { db } from "@/lib/db";
import {
  chunks,
  documents,
  documentVersions,
  ingestionJobs,
  pendingRelationships,
  relationshipEdges,
  sources
} from "@/lib/db/schema";
import type { IngestionPayload } from "@/lib/queue";
import { getGraphQueue } from "@/lib/queue";
import { embedTexts } from "@/lib/services/openrouter";
import { getObject, putObject } from "@/lib/services/storage";
import { deleteDocumentChunks, indexChunks } from "@/lib/services/typesense";
import { invalidateSearchCache } from "@/lib/services/cache";
import { getReductoClient } from "@/lib/services/reducto";

type ParsedChunk = { content: string; page?: number; heading?: string; metadata?: Record<string, unknown> };
type ParsedDocument = { markdown: string; chunks: ParsedChunk[]; parser: string; parserJobId?: string };

export function isCompletedContent(existing: { contentHash: string; deletedAt: Date | null; metadata: Record<string, unknown> }, rawHash: string) {
  return existing.contentHash === rawHash && !existing.deletedAt && existing.metadata.indexStatus === "ready";
}

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["downloadedAt", "rawObjectKey", "parseUrl"].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function normalizedRecordFingerprint(record: NormalizedRecord) {
  return digest(stableJson({
    kind: record.kind, title: record.title, bodyMarkdown: record.bodyMarkdown, sourceUrl: record.sourceUrl,
    authors: record.authors, updatedAt: record.updatedAt?.toISOString(), metadata: record.metadata,
    attachments: record.attachments, relationships: record.relationships
  }));
}

export function shouldEnrichGraph(record: Pick<NormalizedRecord, "kind">, markdown: string) {
  return !config.graph.excludedKinds.includes(record.kind) && markdown.trim().length >= config.graph.minDocumentCharacters;
}

export function normalizeQueuedRecord(record: unknown) {
  return normalizedRecordSchema.parse(record);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "untitled";
}

export function chunkMarkdown(markdown: string): ParsedChunk[] {
  const size = config.ingestion.chunkSize;
  const overlap = Math.min(config.ingestion.chunkOverlap, Math.floor(size / 2));
  const paragraphs = markdown.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const result: ParsedChunk[] = [];
  let buffer = "";
  let heading: string | undefined;

  const push = () => {
    const content = buffer.trim();
    if (content) result.push({ content, heading });
    buffer = content.slice(Math.max(0, content.length - overlap));
  };

  for (const paragraph of paragraphs) {
    if (/^#{1,6}\s/.test(paragraph)) heading = paragraph.replace(/^#{1,6}\s+/, "").trim();
    if (buffer && buffer.length + paragraph.length + 2 > size) push();
    if (paragraph.length > size) {
      for (let offset = 0; offset < paragraph.length; offset += size - overlap) {
        const piece = paragraph.slice(offset, offset + size);
        if (buffer) push();
        buffer = piece;
        if (piece.length === size) push();
      }
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }
  if (buffer.trim()) result.push({ content: buffer.trim(), heading });
  return result.length ? result : [{ content: markdown }];
}

function fenced(content: string, language: string) {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const marker = "`".repeat(longest + 1);
  return `${marker}${language}\n${content}\n${marker}`;
}

export function formatDirectText(title: string, mimeType: string, decoded: string) {
  if (mimeType.includes("json") || /\.json$/i.test(title)) {
    let content = decoded;
    try { content = JSON.stringify(JSON.parse(decoded), null, 2); } catch { /* Preserve malformed JSON losslessly for search and repair. */ }
    return `# ${title}\n\n${fenced(content, "json")}`;
  }
  if (/\.(csv|log)$/i.test(title)) return `# ${title}\n\n${fenced(decoded, "text")}`;
  return decoded;
}

async function parseWithReducto(input: string | Uint8Array, title: string): Promise<ParsedDocument> {
  const reducto = getReductoClient();
  let parseInput: string;
  if (typeof input === "string") {
    parseInput = input;
  } else {
    const upload = await reducto.upload({ file: await Reducto.toFile(input, title) });
    parseInput = upload.file_id;
  }
  const response = await reducto.parse.run({
    input: parseInput,
    formatting: { table_output_format: "md", add_page_markers: true, include: ["hyperlinks", "comments"] },
    enhance: { intelligent_ordering: true, summarize_figures: true },
    retrieval: {
      embedding_optimized: true,
      chunking: {
        chunk_mode: "variable",
        chunk_size: config.ingestion.chunkSize
      }
    }
  }, { timeout: config.ingestion.parseTimeoutMs });
  if (!("result" in response)) throw new Error("Reducto returned an asynchronous response unexpectedly");
  let result = response.result;
  if (result.type === "url") {
    const fetched = await fetch(result.url, { signal: AbortSignal.timeout(config.ingestion.resultDownloadTimeoutMs) });
    if (!fetched.ok) throw new Error("Unable to download Reducto URL result");
    result = (await fetched.json()) as typeof response.result;
  }
  if (result.type !== "full") throw new Error("Reducto did not return a full parse result");
  const parsedChunks = result.chunks.map((chunk) => ({
    content: chunk.enriched || chunk.content,
    page: chunk.blocks[0]?.bbox.page,
    metadata: { blockTypes: [...new Set(chunk.blocks.map((block) => block.type))] }
  }));
  return {
    markdown: parsedChunks.map((chunk) => chunk.content).join("\n\n"),
    chunks: parsedChunks,
    parser: "reducto",
    parserJobId: response.job_id
  };
}

export async function ensureLocalSource() {
  const existing = await db.query.sources.findFirst({
    where: and(eq(sources.workspaceId, config.app.workspaceId), eq(sources.slug, "local"))
  });
  if (existing) return existing;
  const [created] = await db.insert(sources).values({
    workspaceId: config.app.workspaceId,
    slug: "local",
    name: "Local knowledge",
    kind: "local",
    status: "ready"
  }).onConflictDoNothing().returning();
  if (created) return created;
  const raced = await db.query.sources.findFirst({
    where: and(eq(sources.workspaceId, config.app.workspaceId), eq(sources.slug, "local"))
  });
  if (!raced) throw new Error("Unable to create local source");
  return raced;
}

function payloadIdentity(payload: IngestionPayload, hash: string) {
  if (payload.type === "record") return payload.record.externalId;
  if (payload.type === "url") return `url:${payload.url}`;
  if (payload.type === "file") return `file:${slug(payload.title)}`;
  return payload.sourceUrl ? `text:${payload.sourceUrl}` : `text:${hash}`;
}

async function parsePayload(payload: IngestionPayload): Promise<{ record: NormalizedRecord; parsed: ParsedDocument; rawHash: string }> {
  if (payload.type === "record") {
    // BullMQ crosses a JSON boundary, so dates arrive as ISO strings even though
    // the producer supplied Date instances. Revalidate and coerce at the worker.
    const queuedRecord = normalizeQueuedRecord(payload.record);
    const parseUrl = queuedRecord.metadata.parseUrl;
    const rawObjectKey = queuedRecord.metadata.rawObjectKey;
    let parsed: ParsedDocument;
    let metadata = queuedRecord.metadata;
    if (typeof rawObjectKey === "string") {
      parsed = await parseWithReducto(await getObject(rawObjectKey), queuedRecord.title);
    } else if (typeof parseUrl === "string") {
      try {
        parsed = await parseWithReducto(parseUrl, queuedRecord.title);
        metadata = { ...metadata, parseStatus: "ready" };
      } catch (error) {
        // Attachment context and its source relationships are still valuable when
        // a remote provider blocks Reducto's downloader. A later source sync can
        // retry with an authenticated rawObjectKey without losing this record.
        parsed = { markdown: queuedRecord.bodyMarkdown, chunks: chunkMarkdown(queuedRecord.bodyMarkdown), parser: "source-adapter-fallback" };
        metadata = {
          ...metadata,
          parseStatus: "degraded",
          parseError: error instanceof Error ? error.message.slice(0, 500) : "Remote attachment parsing failed"
        };
      }
    } else {
      parsed = { markdown: queuedRecord.bodyMarkdown, chunks: chunkMarkdown(queuedRecord.bodyMarkdown), parser: "source-adapter" };
    }
    const record = { ...queuedRecord, metadata, bodyMarkdown: parsed.markdown };
    const rawHash = normalizedRecordFingerprint(record);
    return {
      rawHash,
      parsed,
      record
    };
  }
  const source = await ensureLocalSource();
  if (payload.type === "text") {
    const record: NormalizedRecord = {
      sourceId: source.id,
      externalId: payloadIdentity(payload, digest(payload.text)),
      kind: payload.kind,
      title: payload.title,
      bodyMarkdown: payload.text,
      sourceUrl: payload.sourceUrl,
      authors: payload.authors,
      metadata: {},
      attachments: [],
      relationships: payload.relationships
    };
    const rawHash = normalizedRecordFingerprint(record);
    return {
      rawHash,
      parsed: { markdown: payload.text, chunks: chunkMarkdown(payload.text), parser: "markdown" },
      record
    };
  }
  if (payload.type === "file") {
    const bytes = await getObject(payload.objectKey);
    const rawHash = digest(bytes);
    const textual = /^(text\/|application\/(json|xml|yaml|x-yaml|javascript))/.test(payload.mimeType) || /\.(md|mdx|txt|csv|json|ya?ml|xml|log)$/i.test(payload.title);
    const decoded = textual ? new TextDecoder("utf-8", { fatal: false }).decode(bytes) : "";
    const markdown = formatDirectText(payload.title, payload.mimeType, decoded);
    const parsed = textual ? { markdown, chunks: chunkMarkdown(markdown), parser: "direct-text" } : await parseWithReducto(bytes, payload.title);
    return {
      rawHash,
      parsed,
      record: {
        sourceId: source.id,
        externalId: payloadIdentity(payload, rawHash),
        kind: payload.mimeType,
        title: payload.title,
        bodyMarkdown: parsed.markdown,
        authors: [],
        metadata: { mimeType: payload.mimeType, size: payload.size, rawObjectKey: payload.objectKey },
        attachments: [],
        relationships: []
      }
    };
  }
  const parsed = await parseWithReducto(payload.url, payload.title ?? payload.url);
  const rawHash = digest(parsed.markdown);
  return {
    rawHash,
    parsed,
    record: {
      sourceId: source.id,
      externalId: payloadIdentity(payload, rawHash),
      kind: "url",
      title: payload.title ?? new URL(payload.url).hostname,
      bodyMarkdown: parsed.markdown,
      sourceUrl: payload.url,
      authors: [],
      metadata: {},
      attachments: [],
      relationships: []
    }
  };
}

async function persistRelationships(sourceId: string, fromExternalId: string, edges: RelationshipEdge[]) {
  const owner = await db.query.documents.findFirst({ where: and(eq(documents.sourceId, sourceId), eq(documents.externalId, fromExternalId)) });
  if (owner) await db.delete(relationshipEdges).where(and(eq(relationshipEdges.fromDocumentId, owner.id), eq(relationshipEdges.provenance, "source")));
  await db.delete(pendingRelationships).where(and(eq(pendingRelationships.sourceId, sourceId), eq(pendingRelationships.fromExternalId, fromExternalId)));
  for (const edge of edges) {
    if (edge.fromExternalId === edge.toExternalId) continue;
    await db.insert(pendingRelationships).values({
      workspaceId: config.app.workspaceId,
      sourceId,
      toSourceId: edge.toSourceId,
      fromExternalId: edge.fromExternalId,
      toExternalId: edge.toExternalId,
      type: edge.type,
      label: edge.label,
      confidence: edge.confidence,
      metadata: edge.metadata
    }).onConflictDoNothing();
  }
  const pending = await db.select().from(pendingRelationships).where(and(
    or(eq(pendingRelationships.sourceId, sourceId), eq(pendingRelationships.toSourceId, sourceId)),
    isNull(pendingRelationships.resolvedAt)
  )).limit(500);
  if (!pending.length) return;
  const sourceIds = [...new Set(pending.flatMap((edge) => [edge.sourceId, edge.toSourceId ?? edge.sourceId]))];
  const externalIds = [...new Set(pending.flatMap((edge) => [edge.fromExternalId, edge.toExternalId]))];
  const rows = await db.select({ id: documents.id, sourceId: documents.sourceId, externalId: documents.externalId }).from(documents)
    .where(and(inArray(documents.sourceId, sourceIds), inArray(documents.externalId, externalIds)));
  const ids = new Map(rows.map((row) => [`${row.sourceId}:${row.externalId}`, row.id]));
  for (const edge of pending) {
    const fromDocumentId = ids.get(`${edge.sourceId}:${edge.fromExternalId}`);
    const toDocumentId = ids.get(`${edge.toSourceId ?? edge.sourceId}:${edge.toExternalId}`);
    if (!fromDocumentId || !toDocumentId) continue;
    await db.insert(relationshipEdges).values({
      workspaceId: config.app.workspaceId, fromDocumentId, toDocumentId, type: edge.type, label: edge.label,
      confidence: edge.confidence, metadata: edge.metadata, provenance: "source"
    }).onConflictDoNothing();
    await db.update(pendingRelationships).set({ resolvedAt: new Date() }).where(eq(pendingRelationships.id, edge.id));
  }
}

export async function processIngestion(jobId: string, payload: IngestionPayload, progress?: (value: number) => Promise<void>) {
  const update = async (stage: string, value: number) => {
    await db.update(ingestionJobs).set({ stage, progress: value, updatedAt: new Date() }).where(eq(ingestionJobs.id, jobId));
    await progress?.(value);
  };

  await db.update(ingestionJobs).set({ status: "active", stage: "parsing", progress: 5, updatedAt: new Date() }).where(eq(ingestionJobs.id, jobId));
  const { record, parsed, rawHash } = await parsePayload(payload);
  const sourceRecord = await db.query.sources.findFirst({ where: eq(sources.id, record.sourceId) });
  if (!sourceRecord) throw new Error(`Source ${record.sourceId} does not exist`);
  await update("persisting", 30);
  const markdownKey = `normalized/${record.sourceId}/${digest(record.externalId)}/${rawHash}.md`;
  await putObject(markdownKey, parsed.markdown, "text/markdown; charset=utf-8");

  const existing = await db.query.documents.findFirst({
    where: and(eq(documents.sourceId, record.sourceId), eq(documents.externalId, record.externalId))
  });
  if (existing && isCompletedContent(existing, rawHash)) {
    await db.update(ingestionJobs).set({
      status: "completed", stage: "deduplicated", progress: 100, documentId: existing.id, updatedAt: new Date()
    }).where(eq(ingestionJobs.id, jobId));
    return existing.id;
  }

  const resumesIncompleteVersion = Boolean(existing && existing.contentHash === rawHash && existing.metadata.indexStatus !== "ready");
  const version = existing ? (resumesIncompleteVersion ? existing.currentVersion : existing.currentVersion + 1) : 1;
  const processingMetadata = { ...record.metadata, indexStatus: "processing" };
  const [document] = existing
    ? await db.update(documents).set({
        title: record.title,
        kind: record.kind,
        sourceUrl: record.sourceUrl,
        authors: record.authors,
        metadata: processingMetadata,
        contentHash: rawHash,
        currentVersion: version,
        objectKey: markdownKey,
        deletedAt: null,
        sourceUpdatedAt: record.updatedAt,
        updatedAt: new Date()
      }).where(eq(documents.id, existing.id)).returning()
    : await db.insert(documents).values({
        workspaceId: config.app.workspaceId,
        sourceId: record.sourceId,
        externalId: record.externalId,
        kind: record.kind,
        title: record.title,
        sourceUrl: record.sourceUrl,
        authors: record.authors,
        metadata: processingMetadata,
        contentHash: rawHash,
        currentVersion: version,
        objectKey: markdownKey,
        sourceCreatedAt: record.createdAt,
        sourceUpdatedAt: record.updatedAt
      }).returning();
  if (!document) throw new Error("Document persistence failed");
  const resumedVersion = resumesIncompleteVersion
    ? await db.query.documentVersions.findFirst({ where: and(eq(documentVersions.documentId, document.id), eq(documentVersions.version, version)) })
    : null;
  const [insertedVersion] = resumedVersion ? [] : await db.insert(documentVersions).values({
      documentId: document.id,
      version,
      contentHash: rawHash,
      markdown: parsed.markdown,
      objectKey: markdownKey,
      parser: parsed.parser,
      parserJobId: parsed.parserJobId,
      metadata: { chunkCount: parsed.chunks.length }
    }).returning();
  const versionRow = resumedVersion ?? insertedVersion;
  if (!versionRow) throw new Error("Document version persistence failed");

  const resumedChunks = resumedVersion
    ? await db.select().from(chunks).where(eq(chunks.versionId, versionRow.id)).orderBy(asc(chunks.ordinal))
    : [];
  const insertedChunks = resumedChunks.length
    ? resumedChunks
    : await db.insert(chunks).values(parsed.chunks.map((chunk, ordinal) => ({
        documentId: document.id,
        versionId: versionRow.id,
        ordinal,
        heading: chunk.heading,
        content: chunk.content,
        tokenCount: Math.ceil(chunk.content.length / 4),
        page: chunk.page,
        metadata: chunk.metadata ?? {}
      }))).returning();

  await update("embedding", 52);
  const vectors: number[][] = [];
  for (let offset = 0; offset < insertedChunks.length; offset += config.ingestion.embeddingBatchSize) {
    const batch = insertedChunks.slice(offset, offset + config.ingestion.embeddingBatchSize);
    vectors.push(...await embedTexts(batch.map((chunk) => chunk.content)));
  }

  await update("indexing", 74);
  if (existing) await deleteDocumentChunks(document.id);
  await indexChunks(insertedChunks.map((chunk, index) => ({
    id: chunk.id,
    documentId: document.id,
    title: document.title,
    content: chunk.content,
    kind: document.kind,
    sourceId: document.sourceId,
    sourceName: sourceRecord.name,
    sourceUrl: document.sourceUrl ?? undefined,
    authors: document.authors,
    updatedAt: Math.floor(document.updatedAt.getTime() / 1000),
    page: chunk.page ?? undefined,
    embedding: vectors[index] ?? []
  })));
  await invalidateSearchCache();
  await persistRelationships(record.sourceId, record.externalId, record.relationships);

  const graphEligible = config.features.semanticGraph && shouldEnrichGraph(record, parsed.markdown);
  await update(graphEligible ? "graph queued" : "finalizing", 90);
  const graphStatus = !config.features.semanticGraph ? "disabled" : graphEligible ? "queued" : "skipped: below semantic threshold";
  await db.update(documents).set({
    metadata: { ...document.metadata, indexStatus: "ready", graphStatus },
    updatedAt: new Date()
  }).where(eq(documents.id, document.id));
  await db.update(ingestionJobs).set({
    status: "completed", stage: "ready", progress: 100, documentId: document.id, updatedAt: new Date()
  }).where(eq(ingestionJobs.id, jobId));
  await progress?.(100);
  if (graphEligible) {
    const previousGraphId = existing?.metadata?.graphDocumentId;
    const previousGraphContentHash = existing?.metadata?.graphContentHash;
    await getGraphQueue().add("enrich", {
      documentId: document.id,
      versionId: versionRow.id,
      ...(typeof previousGraphId === "string" ? { previousGraphId } : {}),
      ...(typeof previousGraphContentHash === "string" ? { previousGraphContentHash } : {})
    }, { jobId: `${document.id}-${version}` }).catch(async (error) => {
      await db.update(documents).set({
        metadata: { ...document.metadata, indexStatus: "ready", graphStatus: `degraded: ${error instanceof Error ? error.message : "queue unavailable"}` },
        updatedAt: new Date()
      }).where(eq(documents.id, document.id));
    });
  }
  return document.id;
}

export async function stageUploadedFile(file: File) {
  if (file.size > config.ingestion.maxFileBytes) throw new Error("File exceeds the configured 100 MB limit");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const objectKey = `raw/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${slug(file.name)}`;
  await putObject(objectKey, bytes, file.type || "application/octet-stream");
  return { objectKey, size: file.size, mimeType: file.type || "application/octet-stream" };
}
