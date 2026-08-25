import { NextResponse } from "next/server";
import { removeConnection } from "@/lib/integrations/composio";
import { validUuid } from "@/lib/http";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid connection ID" }, { status: 400 });
  const removed = await removeConnection(id);
  return removed ? NextResponse.json({ removed: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
