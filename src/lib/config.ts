import rawConfig from "../../config/consts.json";
import { z } from "zod";

const configSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    tagline: z.string(),
    workspaceId: z.string().min(1),
    baseUrl: z.url()
  }),
  services: z.object({
    postgresUrl: z.string().min(1),
    postgresPoolMax: z.number().int().positive(),
    typesenseUrl: z.url(),
    typesenseApiKey: z.string().min(1),
    valkeyUrl: z.string().min(1),
    s3Endpoint: z.url(),
    s3Region: z.string().min(1),
    s3AccessKey: z.string().min(1),
    s3SecretKey: z.string().min(1),
    s3Bucket: z.string().min(1),
    lightRagUrl: z.url(),
    lightRagApiKey: z.string().min(1),
    healthCheckTimeoutMs: z.number().int().positive(),
    providerHealthCacheMs: z.number().int().positive()
  }),
  models: z.object({
    answer: z.string(),
    fast: z.string(),
    embedding: z.string(),
    embeddingDimensions: z.number().int().positive(),
    reranker: z.string(),
    requestTimeoutMs: z.number().int().positive()
  }),
  ingestion: z.object({
    chunkSize: z.number().int().positive(),
    chunkOverlap: z.number().int().nonnegative(),
    embeddingBatchSize: z.number().int().positive(),
    workerConcurrency: z.number().int().positive(),
    indexConcurrency: z.number().int().positive().max(16),
    parseTimeoutMs: z.number().int().positive(),
    resultDownloadTimeoutMs: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
    maxUploadBatchBytes: z.number().int().positive(),
    maxFilesPerRequest: z.number().int().positive(),
    maxTextCharacters: z.number().int().positive(),
    maxMessageCharacters: z.number().int().positive()
  }),
  search: z.object({
    lexicalLimit: z.number().int().positive(),
    hybridCandidateLimit: z.number().int().positive(),
    answerContextLimit: z.number().int().positive(),
    semanticWeight: z.number().min(0).max(1),
    relationshipDepth: z.number().int().min(0).max(3),
    cacheSeconds: z.number().int().nonnegative(),
    cacheTimeoutMs: z.number().int().positive().max(1000),
    uiEmbeddingTimeoutMs: z.number().int().positive(),
    agentEmbeddingTimeoutMs: z.number().int().positive(),
    uiRerankTimeoutMs: z.number().int().positive(),
    agentRerankTimeoutMs: z.number().int().positive()
  }),
  performance: z.object({
    searchFirstPaintP95Ms: z.number().int().positive(),
    cachedTypeaheadP95Ms: z.number().int().positive(),
    hybridUpdateP95Ms: z.number().int().positive(),
    loadConcurrency: z.number().int().positive().max(256),
    loadRequests: z.number().int().positive().max(100000)
  }),
  evaluation: z.object({
    baseUrls: z.array(z.url()).min(1).max(5),
    ingestionTimeoutMs: z.number().int().positive(),
    graphMinimumImprovementPoints: z.number().min(0).max(100)
  }),
  graph: z.object({
    minDocumentCharacters: z.number().int().nonnegative(),
    excludedKinds: z.array(z.string()),
    maxSemanticNodes: z.number().int().positive().max(500),
    popularLabels: z.number().int().positive().max(20),
    semanticDepth: z.number().int().min(1).max(5),
    jobAttempts: z.number().int().positive().max(20),
    jobBackoffMs: z.number().int().positive(),
    insertTimeoutMs: z.number().int().positive(),
    deleteTimeoutMs: z.number().int().positive(),
    processingTimeoutMs: z.number().int().positive(),
    pollIntervalMs: z.number().int().positive().max(5000),
    workerConcurrency: z.number().int().positive().max(8),
    queryTimeoutMs: z.number().int().positive(),
    maxContextCharacters: z.number().int().positive().max(100000),
    maxReferences: z.number().int().positive().max(100),
    maxReferenceCharacters: z.number().int().positive().max(10000),
    visualizationTimeoutMs: z.number().int().positive(),
    healthTimeoutMs: z.number().int().positive()
  }),
  agent: z.object({
    maxSteps: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxEstimatedCostUsd: z.number().positive(),
    maxDocumentCharacters: z.number().int().positive(),
    maxToolResults: z.number().int().positive(),
    maxMessages: z.number().int().positive(),
    maxConversationBytes: z.number().int().positive()
  }),
  workflows: z.object({
    maxActive: z.number().int().positive(),
    maxRunsPerWorkflow: z.number().int().positive(),
    defaultTimezone: z.string().min(1),
    minimumIntervalMinutes: z.number().int().positive()
  }),
  integrations: z.object({
    pollingIntervalMinutes: z.number().int().positive(),
    maxPagesPerRun: z.number().int().positive(),
    recordsPerPage: z.number().int().positive().max(500),
    catalogLimit: z.number().int().positive().max(2000),
    catalogCacheMinutes: z.number().int().positive(),
    maxAttachmentDownloadsPerRun: z.number().int().nonnegative().max(100),
    downloadDirectory: z.string().startsWith("/tmp/"),
    liveSearchConnections: z.number().int().positive().max(10),
    liveSearchResultsPerConnection: z.number().int().positive().max(20)
  }),
  features: z.object({
    semanticGraph: z.boolean(),
    liveSourceSearch: z.boolean(),
    composioIntegrations: z.boolean()
  }),
  integrationProfiles: z.array(z.string()),
  integrationReadTools: z.record(z.string(), z.array(z.string()))
});

export const config = configSchema.parse(rawConfig);
export type AppConfig = z.infer<typeof configSchema>;

export const secrets = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  reductoApiKey: process.env.REDUCTO_API_KEY ?? "",
  composioApiKey: process.env.COMPOSIO_API_KEY ?? ""
};

export function requireSecret(name: keyof typeof secrets) {
  const value = secrets[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
