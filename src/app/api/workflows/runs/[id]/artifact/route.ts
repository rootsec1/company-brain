import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { documentVersions, workflowArtifacts, workflowRuns, workflows } from "@/lib/db/schema";
import { validUuid } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid workflow run" }, { status: 400 });
  const artifact = await db.query.workflowArtifacts.findFirst({ where: eq(workflowArtifacts.runId, id) });
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  const run = await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, id) });
  const workflow = run ? await db.query.workflows.findFirst({ where: and(eq(workflows.id, run.workflowId), eq(workflows.workspaceId, config.app.workspaceId)) }) : null;
  if (!workflow) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  const version = await db.query.documentVersions.findFirst({
    where: eq(documentVersions.documentId, artifact.documentId),
    orderBy: (table, { desc }) => [desc(table.version)]
  });
  if (!version) return NextResponse.json({ error: "Artifact content not found" }, { status: 404 });
  return new Response(version.markdown, {
    headers: {
      "content-type": artifact.contentType,
      "content-disposition": `attachment; filename="${artifact.filename.replace(/["\\]/g, "-")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
