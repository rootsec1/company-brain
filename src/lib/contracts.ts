import { z } from "zod";
import { config } from "@/lib/config";

export const relationshipTypeSchema = z.enum([
  "reply_to",
  "in_thread",
  "attached_to",
  "authored_by",
  "mentions",
  "contained_in",
  "links_to",
  "supersedes",
  "similar_to"
]);

export const relationshipEdgeSchema = z.object({
  fromExternalId: z.string(),
  toExternalId: z.string(),
  toSourceId: z.string().uuid().optional(),
  type: relationshipTypeSchema,
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const attachmentSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  url: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional()
});

export const normalizedRecordSchema = z.object({
  sourceId: z.string(),
  externalId: z.string(),
  kind: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  sourceUrl: z.string().optional(),
  authors: z.array(z.string()).default([]),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  deletedAt: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  attachments: z.array(attachmentSchema).default([]),
  relationships: z.array(relationshipEdgeSchema).default([])
});

export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>;
export type RelationshipEdge = z.infer<typeof relationshipEdgeSchema>;

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  sourceIds: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
  authors: z.array(z.string()).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  mode: z.enum(["lexical", "hybrid", "agent"]).default("hybrid"),
  limit: z.number().int().min(1).max(50).default(20)
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type CitationAnchor = {
  documentId: string;
  chunkId: string;
  title: string;
  sourceUrl?: string;
  page?: number;
};

export type SearchHit = {
  id: string;
  documentId: string;
  title: string;
  snippet: string;
  content: string;
  kind: string;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  authors: string[];
  updatedAt?: string;
  score: number;
  citation: CitationAnchor;
};

export type SourceCapability = {
  canEnumerate: boolean;
  canDeltaSync: boolean;
  canLiveSearch: boolean;
  attachmentSupport: boolean;
};

export interface SourceAdapter {
  inspect(): Promise<SourceCapability>;
  enumerate(cursor?: string): AsyncIterable<NormalizedRecord>;
  fetch(externalId: string): Promise<NormalizedRecord | null>;
  liveSearch(query: string): Promise<NormalizedRecord[]>;
}

export const textIngestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(config.ingestion.maxTextCharacters),
  sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) source URLs are supported").optional(),
  kind: z.string().default("note"),
  authors: z.array(z.string()).default([]),
  relationships: z.array(relationshipEdgeSchema).default([])
});

export const urlIngestSchema = z.object({
  url: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) URLs are supported"),
  title: z.string().trim().max(500).optional()
});
