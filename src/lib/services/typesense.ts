import Typesense, { type Client } from "typesense";
import { config } from "@/lib/config";

let client: Client | undefined;
let activeWrites = 0;
const pendingWrites: Array<() => void> = [];

async function withWritePermit<T>(operation: () => Promise<T>) {
  if (activeWrites >= config.ingestion.indexConcurrency) await new Promise<void>((resolve) => pendingWrites.push(resolve));
  activeWrites += 1;
  try { return await operation(); }
  finally {
    activeWrites -= 1;
    pendingWrites.shift()?.();
  }
}

export function getTypesenseClient() {
  if (!client) {
    const url = new URL(config.services.typesenseUrl);
    client = new Typesense.Client({
      nodes: [{ host: url.hostname, port: Number(url.port || 8108), protocol: url.protocol.replace(":", "") }],
      apiKey: config.services.typesenseApiKey,
      connectionTimeoutSeconds: 3,
      retryIntervalSeconds: 0.2,
      numRetries: 2
    });
  }
  return client;
}

export const chunkCollection = "brain_chunks";

export function assertTypesenseCollectionCompatible(collection: { fields?: Array<{ name?: string; num_dim?: number }> }) {
  const embedding = collection.fields?.find((field) => field.name === "embedding");
  if (embedding?.num_dim !== config.models.embeddingDimensions) {
    throw new Error(`Typesense ${chunkCollection} expects ${embedding?.num_dim ?? "unknown"} embedding dimensions, but config requires ${config.models.embeddingDimensions}. Reindex the collection after changing embedding models.`);
  }
}

export async function ensureTypesenseCollection() {
  const typesense = getTypesenseClient();
  let existing: Awaited<ReturnType<ReturnType<Client["collections"]>["retrieve"]>> | undefined;
  try {
    existing = await typesense.collections(chunkCollection).retrieve();
  } catch (error) {
    if ((error as { httpStatus?: number }).httpStatus !== 404) throw error;
    await typesense.collections().create({
      name: chunkCollection,
      fields: [
        { name: "documentId", type: "string", facet: false },
        { name: "title", type: "string" },
        { name: "content", type: "string" },
        { name: "kind", type: "string", facet: true },
        { name: "sourceId", type: "string", facet: true },
        { name: "sourceName", type: "string", facet: true },
        { name: "sourceUrl", type: "string", optional: true },
        { name: "authors", type: "string[]", facet: true, optional: true },
        { name: "updatedAt", type: "int64", facet: true },
        { name: "page", type: "int32", optional: true },
        { name: "embedding", type: "float[]", num_dim: config.models.embeddingDimensions }
      ],
      default_sorting_field: "updatedAt",
      token_separators: ["_", "-", "/"]
    });
  }
  if (existing) assertTypesenseCollectionCompatible(existing);
}

export type TypesenseChunk = {
  id: string;
  documentId: string;
  title: string;
  content: string;
  kind: string;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  authors: string[];
  updatedAt: number;
  page?: number;
  embedding: number[];
};

export async function indexChunks(records: TypesenseChunk[]) {
  if (!records.length) return;
  await withWritePermit(async () => {
    const response = await getTypesenseClient().collections(chunkCollection).documents().import(records, {
      action: "upsert",
      batch_size: 100
    });
    const failed = response.filter((result: { success: boolean; error?: string }) => !result.success);
    if (failed.length) throw new Error(`Typesense rejected ${failed.length} chunks: ${failed[0]?.error ?? "unknown error"}`);
  });
}

export async function deleteDocumentChunks(documentId: string) {
  return withWritePermit(() => getTypesenseClient()
    .collections(chunkCollection)
    .documents()
    .delete({ filter_by: `documentId:=${JSON.stringify(documentId)}` }));
}
