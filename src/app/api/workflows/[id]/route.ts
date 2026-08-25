import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteWorkflow, setWorkflowEnabled } from "@/lib/services/workflows";
import { readJson, validUuid } from "@/lib/http";

const schema = z.object({ enabled: z.boolean() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid workflow state" }, { status: 400 });
  try {
    const workflow = await setWorkflowEnabled(id, parsed.data.enabled);
    return workflow ? NextResponse.json({ workflow }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update workflow" }, { status: 400 }); }
}
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  const workflow = await deleteWorkflow(id);
  return workflow ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
