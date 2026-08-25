import { inArray } from "drizzle-orm";
import { db, sql } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { getIngestionQueue, getQueueConnection } from "@/lib/queue";

const priorityArgument = process.argv.find((value) => value.startsWith("--priority="));
const channelArgument = process.argv.find((value) => value.startsWith("--channel="));
const channels = new Set(channelArgument?.slice("--channel=".length).split(",").map((value) => value.trim()).filter(Boolean) ?? []);
const priority = Number(priorityArgument?.split("=")[1] ?? 1);
if (!Number.isInteger(priority) || priority < 1 || priority > 2_097_152) throw new Error("Priority must be an integer from 1 to 2,097,152");
const slugs = process.argv.slice(2).filter((value) => !value.startsWith("--priority=") && !value.startsWith("--channel=")).map((value) => value.toLowerCase().trim()).filter(Boolean);
if (!slugs.length) throw new Error("Pass one or more source slugs, for example: bun run ingest:prioritize googledrive linear");

const rows = await db.select({ id: sources.id, slug: sources.slug }).from(sources).where(inArray(sources.slug, slugs));
const sourceIds = new Set(rows.map((row) => row.id));
if (!sourceIds.size) throw new Error(`No source matched: ${slugs.join(", ")}`);

const queue = getIngestionQueue();
const jobs = await queue.getJobs(["waiting", "prioritized", "delayed"], 0, 100_000, true);
let changed = 0;
for (const job of jobs) {
  if (job.data.type !== "record" || !sourceIds.has(job.data.record.sourceId)) continue;
  if (channels.size && !channels.has(String(job.data.record.metadata.channel ?? ""))) continue;
  await job.changePriority({ priority });
  changed += 1;
}
console.info(`[ingestion] set ${changed} jobs to priority ${priority} for ${rows.map((row) => row.slug).join(", ")}${channels.size ? ` in ${[...channels].join(", ")}` : ""}`);
await queue.close();
await getQueueConnection().quit();
await sql.end();
