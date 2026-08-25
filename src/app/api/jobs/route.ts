import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { agentRuns, ingestionJobs, workflowRuns, workflows } from "@/lib/db/schema";

export async function GET() {
  const [jobs, interactiveRuns, scheduledRuns] = await Promise.all([
    db.select().from(ingestionJobs).orderBy(desc(ingestionJobs.createdAt)).limit(50),
    db.select({
      id: agentRuns.id, status: agentRuns.status, model: agentRuns.model, stepCount: agentRuns.stepCount,
      inputTokens: agentRuns.inputTokens, outputTokens: agentRuns.outputTokens, cost: agentRuns.cost,
      latencyMs: agentRuns.latencyMs, error: agentRuns.error, createdAt: agentRuns.createdAt, finishedAt: agentRuns.finishedAt
    }).from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(25),
    db.select({
      id: workflowRuns.id, name: workflows.name, status: workflowRuns.status, stepCount: workflowRuns.stepCount,
      inputTokens: workflowRuns.inputTokens, outputTokens: workflowRuns.outputTokens, cost: workflowRuns.cost,
      latencyMs: workflowRuns.latencyMs, error: workflowRuns.error, createdAt: workflowRuns.createdAt, finishedAt: workflowRuns.finishedAt
    }).from(workflowRuns).innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
      .where(eq(workflows.workspaceId, config.app.workspaceId)).orderBy(desc(workflowRuns.createdAt)).limit(25)
  ]);
  const researchRuns = [
    ...interactiveRuns.map((run) => ({ ...run, name: "Interactive research", kind: "conversation" as const })),
    ...scheduledRuns.map((run) => ({ ...run, model: config.models.answer, kind: "workflow" as const }))
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 30);
  return NextResponse.json({ jobs, researchRuns });
}
