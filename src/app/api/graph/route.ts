import { NextResponse } from "next/server";
import { getRelationshipGraph } from "@/lib/services/search";
import { validUuid } from "@/lib/http";
import { getSemanticGraph } from "@/lib/services/lightrag";

export async function GET(request: Request) {
  const documentId = new URL(request.url).searchParams.get("documentId") ?? undefined;
  if (documentId && !validUuid(documentId)) return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  const structural = await getRelationshipGraph(documentId);
  if (documentId) return NextResponse.json({ ...structural, semanticAvailable: false });
  try {
    const semantic = await getSemanticGraph();
    return NextResponse.json({ nodes: [...structural.nodes, ...semantic.nodes], edges: [...structural.edges, ...semantic.edges], semanticAvailable: semantic.available });
  } catch (error) {
    return NextResponse.json({ ...structural, semanticAvailable: false, warning: error instanceof Error ? error.message : "Semantic graph unavailable" });
  }
}
