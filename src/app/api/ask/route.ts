import { and, desc, eq } from "drizzle-orm";
import { createAgentUIStreamResponse, safeValidateUIMessages, type InferAgentUIMessage } from "ai";
import { z } from "zod";
import { createResearchAgent, openRouterStepCost } from "@/lib/agent/research-agent";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { agentRuns, citations, conversations, messages } from "@/lib/db/schema";

export const maxDuration = 90;

type ResearchUIMessage = InferAgentUIMessage<ReturnType<typeof createResearchAgent>>;

function textOf(message: ResearchUIMessage) {
  return message.parts.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n").trim();
}

function citationAnchors(message: ResearchUIMessage) {
  const anchors = new Map<string, { documentId: string; chunkId: string; quote?: string }>();
  for (const part of message.parts) {
    const value = part as unknown as { type?: string; output?: unknown };
    if (value.type !== "tool-search_chunks" || !Array.isArray(value.output)) continue;
    for (const hit of value.output as Array<{ content?: string; citation?: { documentId?: string; chunkId?: string } }>) {
      const documentId = hit.citation?.documentId;
      const chunkId = hit.citation?.chunkId;
      if (documentId && chunkId) anchors.set(chunkId, { documentId, chunkId, quote: hit.content?.slice(0, 500) });
    }
  }
  return [...anchors.values()];
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { id?: string; messages?: unknown[] } | null;
  if (!body) return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (!Array.isArray(body.messages)) return Response.json({ error: "messages must be an array" }, { status: 400 });
  if (body.messages.length > config.agent.maxMessages || JSON.stringify(body.messages).length > config.agent.maxConversationBytes) {
    return Response.json({ error: "Conversation exceeds the configured request limit" }, { status: 413 });
  }
  const agent = createResearchAgent();
  const validated = await safeValidateUIMessages<ResearchUIMessage>({ messages: body.messages, tools: agent.tools });
  if (!validated.success) return Response.json({ error: "Invalid conversation messages", detail: validated.error.message }, { status: 400 });
  const incomingMessages = validated.data;
  const parsedId = z.string().uuid().safeParse(body.id);
  const conversationId = parsedId.success ? parsedId.data : crypto.randomUUID();
  const existing = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  const latestIncomingUser = [...incomingMessages].reverse().find((message) => message.role === "user");
  if (!latestIncomingUser) return Response.json({ error: "A user message is required" }, { status: 400 });
  let uiMessages: ResearchUIMessage[];
  if (existing) {
    const persisted = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
    const reconstructed = persisted.map((message) => ({
      id: message.clientId ?? message.id,
      role: message.role,
      parts: message.parts ?? [{ type: "text", text: message.content }]
    }));
    if (!persisted.some((message) => message.clientId === latestIncomingUser.id)) reconstructed.push(latestIncomingUser);
    const serverValidated = await safeValidateUIMessages<ResearchUIMessage>({ messages: reconstructed, tools: agent.tools });
    if (!serverValidated.success) return Response.json({ error: "Stored conversation is invalid" }, { status: 500 });
    uiMessages = serverValidated.data;
  } else {
    // A new conversation starts from one genuine user turn; client-supplied assistant/tool history is never trusted.
    uiMessages = [latestIncomingUser];
  }
  if (!existing) {
    const firstUser = uiMessages.find((message) => message.role === "user");
    await db.insert(conversations).values({ id: conversationId, workspaceId: config.app.workspaceId, title: textOf(firstUser ?? uiMessages[0]).slice(0, 100) || "New research" });
  }
  const latestUser = [...uiMessages].reverse().find((message) => message.role === "user");
  if (latestUser) await db.insert(messages).values({ conversationId, clientId: latestUser.id, role: "user", content: textOf(latestUser), parts: latestUser.parts }).onConflictDoNothing();
  const [run] = await db.insert(agentRuns).values({ conversationId, model: config.models.answer, status: "running" }).returning();
  const started = performance.now();
  let stepCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let streamError: string | undefined;
  return createAgentUIStreamResponse({
    agent, uiMessages, generateMessageId: () => crypto.randomUUID(),
    abortSignal: request.signal, timeout: config.agent.timeoutMs, headers: { "x-conversation-id": conversationId },
    onStepEnd: async (step) => {
      stepCount += 1; inputTokens += step.usage.inputTokens ?? 0; outputTokens += step.usage.outputTokens ?? 0; cost += openRouterStepCost(step);
      if (run) await db.update(agentRuns).set({ stepCount, inputTokens, outputTokens, cost }).where(eq(agentRuns.id, run.id));
    },
    onError: (error) => {
      streamError = error instanceof Error ? error.message : "Research generation failed";
      console.error("Research stream failed", error);
      return "Research could not finish synthesizing the evidence. Please retry; the failed run has been recorded.";
    },
    onEnd: async ({ responseMessage, isAborted, finishReason }) => {
      const assistantText = textOf(responseMessage);
      const [saved] = await db.insert(messages).values({ conversationId, clientId: responseMessage.id, role: "assistant", content: assistantText, parts: responseMessage.parts }).onConflictDoNothing().returning();
      const savedMessage = saved ?? await db.query.messages.findFirst({ where: and(eq(messages.conversationId, conversationId), eq(messages.clientId, responseMessage.id)), orderBy: desc(messages.createdAt) });
      if (savedMessage) {
        const anchors = citationAnchors(responseMessage);
        if (anchors.length) await db.insert(citations).values(anchors.map((anchor, ordinal) => ({ messageId: savedMessage.id, documentId: anchor.documentId, chunkId: anchor.chunkId, ordinal: ordinal + 1, quote: anchor.quote }))).onConflictDoNothing();
      }
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      const failed = finishReason === "error" || Boolean(streamError) || !assistantText;
      if (run) await db.update(agentRuns).set({
        status: isAborted ? "cancelled" : failed ? "failed" : "completed",
        stepCount,
        inputTokens,
        outputTokens,
        cost,
        error: isAborted ? "Request cancelled" : failed ? streamError ?? "Agent finished without a synthesized answer" : null,
        latencyMs: Math.round(performance.now() - started),
        finishedAt: new Date()
      }).where(eq(agentRuns.id, run.id));
    }
  });
}
