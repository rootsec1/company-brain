import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "@/lib/config";
import type { RelationshipEdge } from "@/lib/contracts";
import type { NormalizedRecord } from "@/lib/contracts";

export type IngestionPayload =
  | {
      type: "text";
      title: string;
      text: string;
      kind: string;
      sourceUrl?: string;
      authors: string[];
      relationships: RelationshipEdge[];
    }
  | { type: "file"; title: string; objectKey: string; mimeType: string; size: number }
  | { type: "url"; title?: string; url: string }
  | { type: "record"; record: NormalizedRecord };

export type WorkflowPayload = { workflowId: string; runId?: string; trigger: "manual" | "scheduled" };
export type GraphPayload = { documentId: string; versionId: string; previousGraphId?: string; previousGraphContentHash?: string };
export type SyncPayload =
  | { type: "connection"; connectionId: string; syncRunId: string }
  | { type: "sweep" };

let connection: IORedis | undefined;
let ingestionQueue: Queue<IngestionPayload> | undefined;
let workflowQueue: Queue<WorkflowPayload> | undefined;
let syncQueue: Queue<SyncPayload> | undefined;
let graphQueue: Queue<GraphPayload> | undefined;

export function getQueueConnection() {
  connection ??= new IORedis(config.services.valkeyUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true
  });
  return connection;
}

export function getIngestionQueue() {
  ingestionQueue ??= new Queue<IngestionPayload>("ingestion", {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 500,
      removeOnFail: 1000
    }
  });
  return ingestionQueue;
}

export function getWorkflowQueue() {
  workflowQueue ??= new Queue<WorkflowPayload>("workflows", {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 500
    }
  });
  return workflowQueue;
}

export function getSyncQueue() {
  syncQueue ??= new Queue<SyncPayload>("source-sync", {
    connection: getQueueConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 300, removeOnFail: 500 }
  });
  return syncQueue;
}

export function getGraphQueue() {
  graphQueue ??= new Queue<GraphPayload>("graph-enrichment", {
    connection: getQueueConnection(),
    defaultJobOptions: { attempts: config.graph.jobAttempts, backoff: { type: "exponential", delay: config.graph.jobBackoffMs }, removeOnComplete: 500, removeOnFail: 1000 }
  });
  return graphQueue;
}
