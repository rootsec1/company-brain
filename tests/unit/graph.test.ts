import { describe, expect, it } from "vitest";
import { boundGraphContext, canReuseGraphDocument, graphContentHash, lightRagDocumentId, normalizeSemanticGraph } from "@/lib/services/lightrag";

describe("semantic graph adapter", () => {
  it("reuses semantic documents for relationship-only versions", () => {
    const markdown = "# Same semantic content";
    const graphId = lightRagDocumentId("document-1", "Decision");
    expect(canReuseGraphDocument(graphId, graphContentHash(markdown), "document-1", "Decision", markdown)).toBe(true);
    expect(canReuseGraphDocument(graphId, graphContentHash("different"), "document-1", "Decision", markdown)).toBe(false);
  });

  it("namespaces LightRAG entities and keeps provenance distinct from source edges", () => {
    const graph = normalizeSemanticGraph({
      nodes: [
        { id: "risk", labels: ["RISK"], properties: { entity_id: "Launch risk" } },
        { id: "review", labels: ["PROCESS"], properties: { entity_id: "Security review" } }
      ],
      edges: [{ id: "rel-1", source: "risk", target: "review", type: "DEPENDS_ON", properties: { keywords: "blocked by" } }]
    });
    expect(graph.nodes[0]).toMatchObject({ id: "semantic:risk", title: "Launch risk", provenance: "semantic" });
    expect(graph.edges[0]).toMatchObject({ source: "semantic:risk", target: "semantic:review", label: "blocked by", provenance: "semantic" });
  });

  it("bounds graph evidence before returning it to an agent", () => {
    const result = boundGraphContext({
      response: "r".repeat(100),
      references: [
        { reference_id: "ref-1", file_path: "brain://decision", content: "c".repeat(100) },
        { id: "ref-2", title: "Ignored by limit", text: "other" }
      ]
    }, { maxContextCharacters: 20, maxReferences: 1, maxReferenceCharacters: 12 });

    expect(result.response).toHaveLength(20);
    expect(result.references).toEqual([{
      referenceId: "ref-1",
      source: "brain://decision",
      content: "c".repeat(12)
    }]);
  });
});
