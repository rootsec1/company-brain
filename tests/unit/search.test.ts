import { beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY ||= "test-openrouter-key";
  return { perform: vi.fn(), getSearch: vi.fn() };
});

vi.mock("@/lib/services/typesense", () => ({
  chunkCollection: "brain_chunks",
  deleteDocumentChunks: vi.fn(),
  getTypesenseClient: () => ({
    multiSearch: { perform: clients.perform },
    collections: () => ({ documents: () => ({ search: clients.getSearch }) })
  })
}));

vi.mock("@/lib/services/openrouter", () => ({
  embedTexts: vi.fn(async () => [Array.from({ length: 1024 }, () => 0.01)]),
  rerankTexts: vi.fn(async (_query: string, documents: string[]) => documents.map((_, index) => ({ index, relevanceScore: 1 - index * 0.1 })))
}));

import { searchKnowledge } from "@/lib/services/search";

describe("Typesense serving path", () => {
  beforeEach(() => {
    clients.perform.mockReset();
    clients.getSearch.mockReset();
    clients.perform.mockResolvedValue({ results: [{ hits: [{ document: {
      id: "chunk-1", documentId: "doc-1", title: "Launch decision", content: "Ship Friday", kind: "decision",
      sourceId: "slack", sourceName: "Slack", authors: ["Maya"], updatedAt: 1_787_616_000, embedding: []
    }, hybrid_search_info: { rank_fusion_score: 0.9 } }] }] });
  });

  it("uses POST multi-search so 1,024-dimensional vectors never exceed the GET limit", async () => {
    const hits = await searchKnowledge({ query: "launch", mode: "hybrid", limit: 10 });
    expect(hits[0]?.title).toBe("Launch decision");
    expect(clients.perform).toHaveBeenCalledOnce();
    expect(clients.getSearch).not.toHaveBeenCalled();
    const request = clients.perform.mock.calls[0]?.[0] as { searches: Array<{ vector_query?: string }> };
    expect(request.searches[0]?.vector_query).toContain("embedding:([0.01,0.01");
  });
});
