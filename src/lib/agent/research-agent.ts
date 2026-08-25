import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { config, requireSecret } from "@/lib/config";
import { liveSourceSearch } from "@/lib/integrations/composio";
import { getGraphContext } from "@/lib/services/lightrag";
import { findRelated, getDocument, getRelationshipGraph, searchKnowledge } from "@/lib/services/search";

export function openRouterStepCost(step: { providerMetadata?: unknown }) {
  const metadata = step.providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined;
  return typeof metadata?.openrouter?.usage?.cost === "number" ? metadata.openrouter.usage.cost : 0;
}

/** Tool outputs are replayed into the next model call and must be JSON values. */
export function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function shouldForceSynthesis(steps: Array<{ usage: { inputTokens?: number }; providerMetadata?: unknown }>, stepNumber: number) {
  return stepNumber >= config.agent.maxSteps - 1
    || steps.reduce((total, step) => total + (step.usage.inputTokens ?? 0), 0) >= config.agent.maxInputTokens
    // Leave headroom for one tool-free final synthesis call. Provider cost is
    // only known after a model step completes.
    || steps.reduce((total, step) => total + openRouterStepCost(step), 0) >= config.agent.maxEstimatedCostUsd * 0.35;
}

export async function searchChunksWithFallback(
  input: { query: string; sourceIds?: string[]; kinds?: string[]; limit: number },
  search: typeof searchKnowledge = searchKnowledge
) {
  const filtered = await search({ ...input, mode: "agent" });
  if (filtered.length || (!input.sourceIds?.length && !input.kinds?.length)) return filtered;
  return search({ query: input.query, limit: input.limit, mode: "agent" });
}

const searchChunks = tool({
  description: "Search indexed company documents and messages. Returns source-grounded chunks with stable citation anchors.",
  inputSchema: z.object({
    query: z.string().min(1),
    sourceIds: z.array(z.string()).optional(),
    kinds: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(config.agent.maxToolResults).default(12)
  }),
  execute: async ({ query, sourceIds, kinds, limit }) => toJsonSafe(await searchChunksWithFallback({ query, sourceIds, kinds, limit }))
});

const getDocumentTool = tool({
  description: "Read the full current version of a document after finding it in search.",
  inputSchema: z.object({ documentId: z.string().uuid() }),
  execute: async ({ documentId }) => {
    const document = await getDocument(documentId);
    if (!document) return { found: false };
    return toJsonSafe({ found: true, ...document, markdown: document.markdown.slice(0, config.agent.maxDocumentCharacters) });
  }
});

const findRelatedTool = tool({
  description: "Find documents directly related to a document through threads, attachments, folders, authors, links, or versions.",
  inputSchema: z.object({ documentId: z.string().uuid() }),
  execute: async ({ documentId }) => toJsonSafe(await findRelated(documentId))
});

const traverseSourceGraph = tool({
  description: "Traverse the deterministic source relationship graph around a document.",
  inputSchema: z.object({ documentId: z.string().uuid() }),
  execute: async ({ documentId }) => toJsonSafe(await getRelationshipGraph(documentId))
});

const graphContext = tool({
  description: "Retrieve semantic knowledge-graph context for thematic, cross-document, or multi-hop questions. Avoid for simple lookups.",
  inputSchema: z.object({
    query: z.string().min(3),
    mode: z.enum(["local", "global", "mix"]).default("mix")
  }),
  execute: async ({ query, mode }) => {
    try {
      return toJsonSafe(await getGraphContext(query, mode));
    } catch (error) {
      return { unavailable: true, message: error instanceof Error ? error.message : "Knowledge graph unavailable" };
    }
  }
});

const liveSearch = tool({
  description: "Check connected external sources when indexed knowledge is insufficient. This tool is strictly read-only.",
  inputSchema: z.object({ query: z.string().min(1) }),
  execute: async ({ query }) => toJsonSafe(await liveSourceSearch(query))
});

export function createResearchAgent() {
  const openrouter = createOpenRouter({ apiKey: requireSecret("openRouterApiKey") });
  return new ToolLoopAgent({
    id: "company-research-agent",
    model: openrouter(config.models.answer, { usage: { include: true } }),
    instructions: `You are ${config.app.name}, a precise research agent for one company's internal knowledge.

Find evidence before answering. Start with search_chunks. Omit kinds unless you have seen exact indexed kind values; broad words such as "document" or "message" are not valid kind filters. Use get_document for detail, relationship tools when source structure matters, and get_graph_context only for cross-document synthesis. If evidence contains an opaque mention, thread, attachment, or parent identifier, follow its source relationships before saying the identity or context is unresolved. Never perform external mutations.

Every factual company claim must include inline citations in the form [1], [2], etc. Cite only chunk IDs and titles returned by tools. Reuse citation numbers instead of creating a new citation for every sentence. Be concise: prioritize decisions, contradictions, risks, and actions over exhaustive transcription. End with a compact Sources section mapping each number to its document title and source URL when present. If evidence is missing or conflicting, say so directly. Never invent a source, quote, policy, date, person, or relationship.`,
    tools: {
      search_chunks: searchChunks,
      get_document: getDocumentTool,
      find_related: findRelatedTool,
      traverse_source_graph: traverseSourceGraph,
      get_graph_context: graphContext,
      live_source_search: liveSearch
    },
    stopWhen: stepCountIs(config.agent.maxSteps),
    prepareStep: ({ steps, stepNumber, instructions }) => shouldForceSynthesis(steps, stepNumber)
      ? {
          toolChoice: "none",
          instructions: `${typeof instructions === "string" ? instructions : ""}\n\nYou have reached the research budget. Do not call another tool. Synthesize the best concise, cited final answer from the evidence already collected.`
        }
      : undefined,
    maxOutputTokens: config.agent.maxOutputTokens,
    temperature: 0.15,
    maxRetries: 2,
    telemetry: {
      isEnabled: true,
      functionId: "research-agent",
      recordInputs: false,
      recordOutputs: false
    }
  });
}
