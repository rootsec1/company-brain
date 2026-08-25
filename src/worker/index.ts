import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { db, sql } from "@/lib/db";
import { ingestionJobs } from "@/lib/db/schema";
import { getQueueConnection, type GraphPayload, type IngestionPayload, type SyncPayload, type WorkflowPayload } from "@/lib/queue";
import { enqueueStaleConnectionSyncs, enqueueTriggeredConnectionSync, ensureSyncScheduler, processConnectionSync, recordSyncIngestionOutcome } from "@/lib/integrations/sync";
import { subscribeToComposioTriggers, unsubscribeFromComposioTriggers } from "@/lib/integrations/composio";
import { processIngestion } from "@/lib/services/ingestion";
import { processGraphEnrichment } from "@/lib/services/lightrag";
import { processWorkflowRun } from "@/lib/services/workflows";

const worker = new Worker<IngestionPayload>("ingestion", async (job) => {
  try {
    const result = await processIngestion(job.id ?? "unknown", job.data, (progress) => job.updateProgress(progress));
    const persisted = await db.query.ingestionJobs.findFirst({ where: eq(ingestionJobs.id, job.id ?? "unknown") });
    await recordSyncIngestionOutcome(persisted?.syncRunId, true);
    return result;
  } catch (error) {
    await db.update(ingestionJobs).set({
      status: "failed",
      stage: "failed",
      error: error instanceof Error ? error.message : "Unknown ingestion error",
      updatedAt: new Date()
    }).where(eq(ingestionJobs.id, job.id ?? "unknown"));
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      const persisted = await db.query.ingestionJobs.findFirst({ where: eq(ingestionJobs.id, job.id ?? "unknown") });
      await recordSyncIngestionOutcome(persisted?.syncRunId, false);
    }
    throw error;
  }
}, {
  connection: getQueueConnection(),
  concurrency: config.ingestion.workerConcurrency,
  lockDuration: config.ingestion.parseTimeoutMs + 60_000
});

const workflowWorker = new Worker<WorkflowPayload>("workflows", (job) => processWorkflowRun(job.data), {
  connection: getQueueConnection(),
  concurrency: Math.max(1, Math.floor(config.ingestion.workerConcurrency / 2)),
  lockDuration: config.agent.timeoutMs + 30_000
});

const syncWorker = new Worker<SyncPayload>("source-sync", (job) => job.data.type === "sweep"
  ? enqueueStaleConnectionSyncs()
  : processConnectionSync(job.data.connectionId, job.data.syncRunId), {
  connection: getQueueConnection(), concurrency: 2, lockDuration: 15 * 60 * 1000
});

const graphWorker = new Worker<GraphPayload>("graph-enrichment", (job) => processGraphEnrichment(job.data), {
  connection: getQueueConnection(), concurrency: config.graph.workerConcurrency, lockDuration: 15 * 60 * 1000
});

worker.on("completed", (job) => console.info(`[worker] completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`[worker] failed ${job?.id}`, error));
worker.on("error", (error) => console.error("[worker] queue error", error));
workflowWorker.on("completed", (job) => console.info(`[workflow] completed ${job.id}`));
workflowWorker.on("failed", (job, error) => console.error(`[workflow] failed ${job?.id}`, error));
workflowWorker.on("error", (error) => console.error("[workflow] queue error", error));
syncWorker.on("completed", (job) => console.info(`[sync] completed ${job.id}`));
syncWorker.on("failed", (job, error) => console.error(`[sync] failed ${job?.id}`, error));
syncWorker.on("error", (error) => console.error("[sync] queue error", error));
graphWorker.on("completed", (job) => console.info(`[graph] completed ${job.id}`));
graphWorker.on("failed", (job, error) => console.error(`[graph] failed ${job?.id}`, error));
graphWorker.on("error", (error) => console.error("[graph] queue error", error));

async function shutdown(signal: string) {
  console.info(`[worker] ${signal}; draining`);
  await unsubscribeFromComposioTriggers().catch(() => undefined);
  await worker.close();
  await workflowWorker.close();
  await syncWorker.close();
  await graphWorker.close();
  await getQueueConnection().quit();
  await sql.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.info(`[worker] listening with concurrency=${config.ingestion.workerConcurrency}`);
void ensureSyncScheduler().then(() => enqueueStaleConnectionSyncs()).catch((error) => console.error("[sync] scheduler setup failed", error));
void subscribeToComposioTriggers(async (payload) => {
  const account = payload.metadata?.connectedAccount;
  if (!account) return;
  await enqueueTriggeredConnectionSync([account.id, account.uuid]);
}).then((active) => {
  if (active) console.info("[composio] listening for configured incremental triggers");
}).catch((error) => console.error("[composio] trigger subscription failed; polling remains active", error));
