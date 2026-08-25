import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "@/lib/config";
import { liveSourceSearch } from "@/lib/integrations/composio";
import { getGraphContext } from "@/lib/services/lightrag";
import { findRelated, getDocument, getRelationshipGraph, searchKnowledge } from "@/lib/services/search";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: "aperture-company-brain", version: "0.1.0" });
  server.registerTool("search_chunks", {
    title: "Search company knowledge", description: "Hybrid-search indexed company context and return stable citation anchors.",
    inputSchema: { query: z.string().min(1), sourceIds: z.array(z.string()).optional(), kinds: z.array(z.string()).optional(), limit: z.number().int().min(1).max(config.agent.maxToolResults).default(12) }, annotations: readOnly
  }, async ({ query, sourceIds, kinds, limit }) => result(await searchKnowledge({ query, sourceIds, kinds, limit, mode: "agent" })));
  server.registerTool("get_document", {
    title: "Get document", description: "Read the current full Markdown version of an indexed document.",
    inputSchema: { documentId: z.string().uuid() }, annotations: readOnly
  }, async ({ documentId }) => {
    const document = await getDocument(documentId);
    return result(document ? { ...document, markdown: document.markdown.slice(0, config.agent.maxDocumentCharacters) } : null);
  });
  server.registerTool("find_related", {
    title: "Find related context", description: "Find directly related documents through source-derived relationships.",
    inputSchema: { documentId: z.string().uuid() }, annotations: readOnly
  }, async ({ documentId }) => result(await findRelated(documentId)));
  server.registerTool("traverse_source_graph", {
    title: "Traverse source graph", description: "Traverse deterministic threads, attachments, links, folders, and versions.",
    inputSchema: { documentId: z.string().uuid() }, annotations: readOnly
  }, async ({ documentId }) => result(await getRelationshipGraph(documentId)));
  server.registerTool("get_graph_context", {
    title: "Get semantic graph context", description: "Retrieve semantic multi-document knowledge-graph context.",
    inputSchema: { query: z.string().min(3), mode: z.enum(["local", "global", "mix"]).default("mix") }, annotations: readOnly
  }, async ({ query, mode }) => result(await getGraphContext(query, mode)));
  server.registerTool("live_source_search", {
    title: "Search connected sources", description: "Check read-only connected source availability when indexed context is insufficient.",
    inputSchema: { query: z.string().min(1) }, annotations: { ...readOnly, openWorldHint: true }
  }, async ({ query }) => result(await liveSourceSearch(query)));
  return server;
}
