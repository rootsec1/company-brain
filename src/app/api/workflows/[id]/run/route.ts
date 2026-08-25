import { NextResponse } from "next/server";
import { enqueueWorkflowRun } from "@/lib/services/workflows";
import { validUuid } from "@/lib/http";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  try { return NextResponse.json({ run: await enqueueWorkflowRun(id) }, { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run workflow" }, { status: 404 }); }
}
