import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { agentRuns, conversations, messages } from "@/lib/db/schema";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
    const conversation = await db.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.workspaceId, config.app.workspaceId)) });
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [messageRows, runs] = await Promise.all([
      db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt),
      db.select().from(agentRuns).where(eq(agentRuns.conversationId, id)).orderBy(desc(agentRuns.createdAt)).limit(20)
    ]);
    return NextResponse.json({ conversation, messages: messageRows.map((message) => ({ id: message.clientId ?? message.id, role: message.role, parts: message.parts ?? [{ type: "text", text: message.content }] })), runs });
  }
  const rows = await db.select().from(conversations).where(eq(conversations.workspaceId, config.app.workspaceId)).orderBy(desc(conversations.updatedAt)).limit(30);
  return NextResponse.json({ conversations: rows });
}
