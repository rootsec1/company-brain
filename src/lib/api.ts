import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { ingestionJobs } from "@/lib/db/schema";
import { getIngestionQueue, type IngestionPayload } from "@/lib/queue";

export async function enqueueIngestion(payload: IngestionPayload, title?: string, options?: { syncRunId?: string }) {
  const id = randomUUID();
  await db.insert(ingestionJobs).values({
    id,
    workspaceId: config.app.workspaceId,
    type: payload.type,
    title,
    status: "queued",
    stage: "queued",
    progress: 0,
    syncRunId: options?.syncRunId,
    payload: payload.type === "text"
      ? { ...payload, text: `[${payload.text.length} characters]` }
      : payload.type === "record"
        ? { type: "record", record: { ...payload.record, bodyMarkdown: `[${payload.record.bodyMarkdown.length} characters]` } }
        : payload
  });
  try {
    await getIngestionQueue().add("ingest", payload, { jobId: id });
  } catch (error) {
    await db.delete(ingestionJobs).where((await import("drizzle-orm")).eq(ingestionJobs.id, id));
    throw error;
  }
  return id;
}
