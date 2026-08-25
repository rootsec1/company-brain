import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { validUuid } from "@/lib/http";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  const [deleted] = await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.workspaceId, config.app.workspaceId))).returning();
  return deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
