import { NextResponse } from "next/server";
import { createWorkflow, listWorkflows, workflowDraftSchema } from "@/lib/services/workflows";
import { readJson } from "@/lib/http";

export async function GET() { return NextResponse.json({ workflows: await listWorkflows() }); }

export async function POST(request: Request) {
  const parsed = workflowDraftSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid workflow", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ workflow: await createWorkflow(parsed.data) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Workflow creation failed" }, { status: 400 }); }
}
