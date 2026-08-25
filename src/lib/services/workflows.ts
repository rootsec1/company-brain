import { randomUUID } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { and, desc, eq, inArray } from "drizzle-orm";
import { generateText, Output } from "ai";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import { config, requireSecret, secrets } from "@/lib/config";
import { db } from "@/lib/db";
import { documents, ingestionJobs, workflowArtifacts, workflowRuns, workflows } from "@/lib/db/schema";
import { getWorkflowQueue, type WorkflowPayload } from "@/lib/queue";
import { createResearchAgent, openRouterStepCost } from "@/lib/agent/research-agent";
import { ensureLocalSource, processIngestion } from "@/lib/services/ingestion";

export const workflowDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  prompt: z.string().trim().min(3).max(5000),
  schedule: z.string().trim().nullable().default(null),
  timezone: z.string().trim().min(1).default(config.workflows.defaultTimezone),
  output: z.enum(["answer", "markdown", "json"]).default("answer")
});

type WorkflowOutput = z.infer<typeof workflowDraftSchema>["output"];

export function inferWorkflowOutput(instruction: string): WorkflowOutput {
  if (/\b(json|machine[- ]readable|structured data)\b/i.test(instruction)) return "json";
  if (/\b(file|document|brief|memo|report|artifact|markdown|export)\b/i.test(instruction)) return "markdown";
  return "answer";
}

function hourFrom(text: string) {
  const match = text.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return { hour: 9, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (match[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (match[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
  return { hour: Math.min(23, hour), minute: Math.min(59, minute) };
}

export function inferSchedule(text: string) {
  const lower = text.toLowerCase();
  const explicit = text.match(/cron\s*:\s*([^\n]+)/i)?.[1]?.trim();
  if (explicit) return explicit;
  const minutes = lower.match(/every\s+(\d+)\s+minutes?/);
  if (minutes) return `*/${Math.max(config.workflows.minimumIntervalMinutes, Number(minutes[1]))} * * * *`;
  const hours = lower.match(/every\s+(\d+)\s+hours?/);
  if (hours) return `0 */${Math.max(1, Math.min(23, Number(hours[1])))} * * *`;
  const { hour, minute } = hourFrom(lower);
  if (/weekday|monday through friday/.test(lower)) return `${minute} ${hour} * * 1-5`;
  const weekdays: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  for (const [day, ordinal] of Object.entries(weekdays)) if (lower.includes(day)) return `${minute} ${hour} * * ${ordinal}`;
  if (/daily|every day|each day/.test(lower)) return `${minute} ${hour} * * *`;
  if (/weekly|every week/.test(lower)) return `${minute} ${hour} * * 1`;
  return null;
}

export function assertSafeSchedule(schedule: string | null, timezone = config.workflows.defaultTimezone) {
  if (!schedule) return;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5 || parts.some((part) => !/^[\d*,\-/]+$/.test(part))) throw new Error("Schedule must be a five-field cron expression");
  try {
    const expression = CronExpressionParser.parse(schedule, { tz: timezone });
    let previous = expression.next().getTime();
    for (let occurrence = 0; occurrence < 20; occurrence += 1) {
      const next = expression.next().getTime();
      if (next - previous < config.workflows.minimumIntervalMinutes * 60_000) throw new Error("too frequent");
      previous = next;
    }
  } catch {
    throw new Error(`Schedule must be valid and at least ${config.workflows.minimumIntervalMinutes} minutes apart`);
  }
}

export function fallbackWorkflowDraft(instruction: string) {
  const schedule = inferSchedule(instruction);
  const question = instruction
    .replace(/\b(every weekday|daily|every day|each day|weekly|every week|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday)\b/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .replace(/\s+/g, " ").trim();
  return workflowDraftSchema.parse({
    name: question.slice(0, 72) || "Company intelligence brief",
    description: "A read-only research workflow created from a natural-language instruction.",
    prompt: question || instruction,
    schedule,
    timezone: config.workflows.defaultTimezone,
    output: inferWorkflowOutput(instruction)
  });
}

export async function draftWorkflow(instruction: string) {
  const fallback = fallbackWorkflowDraft(instruction);
  if (!secrets.openRouterApiKey) return fallback;
  try {
    const openrouter = createOpenRouter({ apiKey: requireSecret("openRouterApiKey") });
    const { output } = await generateText({
      model: openrouter(config.models.fast),
      output: Output.object({ schema: workflowDraftSchema }),
      prompt: `Turn this instruction into a read-only company research workflow. Preserve the complete research objective as prompt. Use a standard five-field cron schedule or null. Set output to markdown or json only when the instruction requests a generated file, brief, memo, report, export, or structured data; otherwise use answer. Never add external write/send/update actions. Timezone defaults to UTC.\n\nInstruction: ${instruction}`,
      temperature: 0,
      maxOutputTokens: 900,
      timeout: 20_000
    });
    const draft = output ?? fallback;
    assertSafeSchedule(draft.schedule, draft.timezone);
    return draft;
  } catch {
    assertSafeSchedule(fallback.schedule, fallback.timezone);
    return fallback;
  }
}

export async function listWorkflows() {
  const rows = await db.select().from(workflows).where(eq(workflows.workspaceId, config.app.workspaceId)).orderBy(desc(workflows.updatedAt));
  const runs = await db.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt)).limit(100);
  const artifacts = runs.length ? await db.select().from(workflowArtifacts).where(inArray(workflowArtifacts.runId, runs.map((run) => run.id))) : [];
  const artifactByRun = new Map(artifacts.map((artifact) => [artifact.runId, artifact]));
  return rows.map((workflow) => ({
    ...workflow,
    output: z.enum(["answer", "markdown", "json"]).catch("answer").parse(workflow.config.output),
    runs: runs.filter((run) => run.workflowId === workflow.id).slice(0, 5).map((run) => ({ ...run, artifact: artifactByRun.get(run.id) }))
  }));
}

export async function createWorkflow(draft: z.infer<typeof workflowDraftSchema>) {
  assertSafeSchedule(draft.schedule, draft.timezone);
  const [created] = await db.insert(workflows).values({
    workspaceId: config.app.workspaceId,
    name: draft.name,
    description: draft.description,
    prompt: draft.prompt,
    schedule: draft.schedule,
    timezone: draft.timezone,
    enabled: false,
    status: "draft",
    config: { output: draft.output }
  }).returning();
  if (!created) throw new Error("Unable to create workflow");
  return created;
}

export async function setWorkflowEnabled(id: string, enabled: boolean) {
  const workflow = await db.query.workflows.findFirst({ where: and(eq(workflows.id, id), eq(workflows.workspaceId, config.app.workspaceId)) });
  if (!workflow) return null;
  if (enabled && !workflow.schedule) throw new Error("Add a schedule before activating this workflow");
  if (enabled) {
    if (!workflow.enabled) {
      const active = await db.$count(workflows, and(eq(workflows.workspaceId, config.app.workspaceId), eq(workflows.enabled, true)));
      if (active >= config.workflows.maxActive) throw new Error(`At most ${config.workflows.maxActive} workflows may be active`);
    }
    assertSafeSchedule(workflow.schedule, workflow.timezone);
    await getWorkflowQueue().upsertJobScheduler(id, { pattern: workflow.schedule!, tz: workflow.timezone }, {
      name: "scheduled-research", data: { workflowId: id, trigger: "scheduled" }, opts: { attempts: 2 }
    });
  } else {
    await getWorkflowQueue().removeJobScheduler(id);
  }
  const nextRunAt = enabled && workflow.schedule ? CronExpressionParser.parse(workflow.schedule, { tz: workflow.timezone }).next().toDate() : null;
  const [updated] = await db.update(workflows).set({ enabled, status: enabled ? "active" : "paused", nextRunAt, updatedAt: new Date() }).where(eq(workflows.id, id)).returning();
  return updated ?? null;
}

async function trimWorkflowRuns(workflowId: string) {
  const stale = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.createdAt)).offset(config.workflows.maxRunsPerWorkflow).limit(500);
  if (stale.length) await db.delete(workflowRuns).where(inArray(workflowRuns.id, stale.map((run) => run.id)));
}

export async function enqueueWorkflowRun(workflowId: string, trigger: WorkflowPayload["trigger"] = "manual") {
  const workflow = await db.query.workflows.findFirst({ where: and(eq(workflows.id, workflowId), eq(workflows.workspaceId, config.app.workspaceId)) });
  if (!workflow) throw new Error("Workflow not found");
  const activeRun = await db.query.workflowRuns.findFirst({ where: and(eq(workflowRuns.workflowId, workflowId), inArray(workflowRuns.status, ["queued", "running"])) });
  if (activeRun) return activeRun;
  const [run] = await db.insert(workflowRuns).values({ workflowId, trigger, status: "queued" }).returning();
  if (!run) throw new Error("Unable to create workflow run");
  try {
    await getWorkflowQueue().add("research", { workflowId, runId: run.id, trigger }, { jobId: run.id });
  } catch (error) {
    await db.delete(workflowRuns).where(eq(workflowRuns.id, run.id));
    throw error;
  }
  await trimWorkflowRuns(workflowId);
  return run;
}

export async function processWorkflowRun(payload: WorkflowPayload) {
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, payload.workflowId) });
  if (!workflow) throw new Error("Workflow not found");
  let runId = payload.runId;
  if (!runId) {
    const [created] = await db.insert(workflowRuns).values({ workflowId: workflow.id, trigger: payload.trigger, status: "queued" }).returning();
    runId = created?.id;
  }
  if (!runId) throw new Error("Workflow run could not be created");
  await trimWorkflowRuns(workflow.id);
  const started = performance.now();
  await db.update(workflowRuns).set({ status: "running", startedAt: new Date() }).where(eq(workflowRuns.id, runId));
  try {
    const output = z.enum(["answer", "markdown", "json"]).catch("answer").parse(workflow.config.output);
    const formatInstruction = output === "answer" ? "" : output === "json"
      ? "\n\nProduce a self-contained artifact. Organize the answer clearly; it will be wrapped in a valid JSON evidence package after generation."
      : "\n\nProduce a polished, self-contained Markdown artifact with an executive summary, findings, risks, recommended actions, and cited sources.";
    const result = await createResearchAgent().generate({ prompt: `${workflow.prompt}${formatInstruction}`, timeout: config.agent.timeoutMs });
    if (!result.text.trim()) throw new Error("Research budget ended before a final answer was produced");
    const evidence = result.steps.flatMap((step) => step.toolResults).slice(0, 50) as unknown[];
    const cost = result.steps.reduce((total, step) => total + openRouterStepCost(step), 0);
    const artifact = output === "answer" ? undefined : await persistWorkflowArtifact({
      runId,
      workflowName: workflow.name,
      output,
      answer: result.text,
      evidence
    });
    await db.update(workflowRuns).set({
      status: "completed", answer: result.text, evidence, stepCount: result.steps.length,
      inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0,
      cost, latencyMs: Math.round(performance.now() - started), error: null, finishedAt: new Date()
    }).where(eq(workflowRuns.id, runId));
    const nextRunAt = workflow.enabled && workflow.schedule ? CronExpressionParser.parse(workflow.schedule, { tz: workflow.timezone }).next().toDate() : null;
    await db.update(workflows).set({ lastRunAt: new Date(), nextRunAt, status: workflow.enabled ? "active" : workflow.status, updatedAt: new Date() }).where(eq(workflows.id, workflow.id));
    return { runId, answer: result.text, artifact };
  } catch (error) {
    await db.update(workflowRuns).set({ status: "failed", error: error instanceof Error ? error.message : "Workflow failed", latencyMs: Math.round(performance.now() - started), finishedAt: new Date() }).where(eq(workflowRuns.id, runId));
    throw error;
  }
}

function collectDocumentIds(value: unknown, ids = new Set<string>()) {
  if (Array.isArray(value)) for (const item of value) collectDocumentIds(item, ids);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "documentId" && typeof item === "string" && z.string().uuid().safeParse(item).success) ids.add(item);
      else collectDocumentIds(item, ids);
    }
  }
  return ids;
}

function artifactSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "company-research";
}

export function formatWorkflowArtifact(input: { workflowName: string; output: Exclude<WorkflowOutput, "answer">; answer: string; sources: Array<{ title: string; sourceUrl: string | null }> }) {
  if (input.output === "json") return JSON.stringify({
    title: input.workflowName,
    generatedAt: new Date().toISOString(),
    answer: input.answer,
    sources: input.sources
  }, null, 2);
  return input.answer;
}

async function persistWorkflowArtifact(input: { runId: string; workflowName: string; output: Exclude<WorkflowOutput, "answer">; answer: string; evidence: unknown[] }) {
  const ids = [...collectDocumentIds(input.evidence)];
  const evidenceDocuments = ids.length ? await db.select({
    id: documents.id,
    sourceId: documents.sourceId,
    externalId: documents.externalId,
    title: documents.title,
    sourceUrl: documents.sourceUrl
  }).from(documents).where(inArray(documents.id, ids)) : [];
  const source = await ensureLocalSource();
  const externalId = `workflow-artifact:${input.runId}`;
  const content = formatWorkflowArtifact({ workflowName: input.workflowName, output: input.output, answer: input.answer, sources: evidenceDocuments });
  const extension = input.output === "json" ? "json" : "md";
  const contentType = input.output === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8";
  const filename = `${artifactSlug(input.workflowName)}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  const jobId = randomUUID();
  const record = {
    sourceId: source.id,
    externalId,
    kind: `workflow_artifact_${input.output}`,
    title: input.workflowName,
    bodyMarkdown: content,
    authors: [config.app.name],
    metadata: { generated: true, workflowRunId: input.runId, format: input.output, filename },
    attachments: [],
    relationships: evidenceDocuments.map((document) => ({
      fromExternalId: externalId,
      toExternalId: document.externalId,
      toSourceId: document.sourceId,
      type: "links_to" as const,
      label: "Evidence used by generated artifact",
      metadata: { citation: true }
    }))
  };
  await db.insert(ingestionJobs).values({
    id: jobId,
    workspaceId: config.app.workspaceId,
    type: "record",
    title: input.workflowName,
    status: "queued",
    stage: "queued",
    progress: 0,
    payload: { type: "record", record: { ...record, bodyMarkdown: `[${content.length} characters]` } }
  });
  let documentId: string;
  try {
    documentId = await processIngestion(jobId, { type: "record", record });
  } catch (error) {
    await db.update(ingestionJobs).set({ status: "failed", stage: "failed", error: error instanceof Error ? error.message : "Artifact ingestion failed", updatedAt: new Date() }).where(eq(ingestionJobs.id, jobId));
    throw error;
  }
  const [artifact] = await db.insert(workflowArtifacts).values({ runId: input.runId, documentId, format: input.output, filename, contentType }).returning();
  if (!artifact) throw new Error("Unable to persist workflow artifact");
  return artifact;
}

export async function deleteWorkflow(id: string) {
  await getWorkflowQueue().removeJobScheduler(id).catch(() => false);
  const [deleted] = await db.delete(workflows).where(and(eq(workflows.id, id), eq(workflows.workspaceId, config.app.workspaceId))).returning();
  return deleted ?? null;
}
