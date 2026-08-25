import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ...timestamps
});

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  iconUrl: text("icon_url"),
  status: text("status").default("ready").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("sources_workspace_slug_idx").on(table.workspaceId, table.slug)]);

export const connections = pgTable("connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "cascade" }).notNull(),
  toolkit: text("toolkit").notNull(),
  composioSessionId: text("composio_session_id"),
  connectedAccountId: text("connected_account_id"),
  status: text("status").default("pending").notNull(),
  cursor: text("cursor"),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().default({}).notNull(),
  importRecipe: jsonb("import_recipe").$type<Record<string, unknown>>(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  ...timestamps
}, (table) => [uniqueIndex("connections_source_idx").on(table.sourceId)]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("queued").notNull(),
  scanned: integer("scanned").default(0).notNull(),
  indexed: integer("indexed").default(0).notNull(),
  failed: integer("failed").default(0).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps
});

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  sourceId: uuid("source_id").references(() => sources.id).notNull(),
  externalId: text("external_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  authors: jsonb("authors").$type<string[]>().default([]).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  contentHash: text("content_hash").notNull(),
  currentVersion: integer("current_version").default(1).notNull(),
  objectKey: text("object_key"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("documents_source_external_idx").on(table.sourceId, table.externalId),
  index("documents_workspace_updated_idx").on(table.workspaceId, table.updatedAt)
]);

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  version: integer("version").notNull(),
  contentHash: text("content_hash").notNull(),
  markdown: text("markdown").notNull(),
  objectKey: text("object_key"),
  parser: text("parser").notNull(),
  parserJobId: text("parser_job_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("document_versions_doc_version_idx").on(table.documentId, table.version)]);

export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  versionId: uuid("version_id").references(() => documentVersions.id, { onDelete: "cascade" }).notNull(),
  ordinal: integer("ordinal").notNull(),
  heading: text("heading"),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  page: integer("page"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("chunks_version_ordinal_idx").on(table.versionId, table.ordinal),
  index("chunks_document_idx").on(table.documentId)
]);

export const relationshipEdges = pgTable("relationship_edges", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  fromDocumentId: uuid("from_document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  toDocumentId: uuid("to_document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  label: text("label"),
  provenance: text("provenance").default("source").notNull(),
  confidence: real("confidence"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("relationship_unique_idx").on(table.fromDocumentId, table.toDocumentId, table.type),
  index("relationship_from_idx").on(table.fromDocumentId),
  index("relationship_to_idx").on(table.toDocumentId)
]);

export const pendingRelationships = pgTable("pending_relationships", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "cascade" }).notNull(),
  toSourceId: uuid("to_source_id").references(() => sources.id, { onDelete: "cascade" }),
  fromExternalId: text("from_external_id").notNull(),
  toExternalId: text("to_external_id").notNull(),
  type: text("type").notNull(),
  label: text("label"),
  confidence: real("confidence"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("pending_relationship_unique_idx").on(table.sourceId, table.fromExternalId, table.toExternalId, table.type),
  index("pending_relationship_source_idx").on(table.sourceId, table.resolvedAt)
]);

export const ingestionJobs = pgTable("ingestion_jobs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  type: text("type").notNull(),
  title: text("title"),
  status: text("status").default("queued").notNull(),
  progress: integer("progress").default(0).notNull(),
  stage: text("stage").default("queued").notNull(),
  documentId: uuid("document_id").references(() => documents.id),
  syncRunId: uuid("sync_run_id").references(() => syncRuns.id, { onDelete: "set null" }),
  error: text("error"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  title: text("title").default("New research").notNull(),
  ...timestamps
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  clientId: text("client_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  parts: jsonb("parts").$type<unknown[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("messages_conversation_client_idx").on(table.conversationId, table.clientId)]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  status: text("status").default("running").notNull(),
  model: text("model").notNull(),
  stepCount: integer("step_count").default(0).notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cost: real("cost"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true })
});

export const citations = pgTable("citations", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
  documentId: uuid("document_id").references(() => documents.id).notNull(),
  chunkId: uuid("chunk_id").references(() => chunks.id).notNull(),
  ordinal: integer("ordinal").notNull(),
  quote: text("quote"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const serviceHealth = pgTable("service_health", {
  service: text("service").primaryKey(),
  healthy: boolean("healthy").default(false).notNull(),
  latencyMs: integer("latency_ms"),
  detail: text("detail"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull()
});

export const workflows = pgTable("workflows", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id).notNull(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  prompt: text("prompt").notNull(),
  schedule: text("schedule"),
  timezone: text("timezone").default("UTC").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  status: text("status").default("draft").notNull(),
  delivery: text("delivery").default("inbox").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [index("workflows_workspace_status_idx").on(table.workspaceId, table.status)]);

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }).notNull(),
  trigger: text("trigger").default("manual").notNull(),
  status: text("status").default("queued").notNull(),
  answer: text("answer"),
  evidence: jsonb("evidence").$type<unknown[]>().default([]).notNull(),
  stepCount: integer("step_count").default(0).notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cost: real("cost"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("workflow_runs_workflow_created_idx").on(table.workflowId, table.createdAt)]);

export const workflowArtifacts = pgTable("workflow_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "cascade" }).notNull(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  format: text("format").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("workflow_artifacts_run_idx").on(table.runId),
  index("workflow_artifacts_document_idx").on(table.documentId)
]);
