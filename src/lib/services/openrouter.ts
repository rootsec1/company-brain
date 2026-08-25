import { OpenRouter } from "@openrouter/sdk";
import { config, requireSecret, secrets } from "@/lib/config";

let client: OpenRouter | undefined;

export function normalizeEmbeddingInputs(texts: string[]) {
  // A few parsers legitimately emit layout-only chunks. Keep vector/result
  // cardinality stable while avoiding provider 400s for empty inputs.
  return texts.map((text) => text.trim() || "(empty content)");
}

function getClient() {
  if (!client) {
    client = new OpenRouter({
      apiKey: requireSecret("openRouterApiKey"),
      httpReferer: config.app.baseUrl,
      appTitle: config.app.name,
      appCategories: "productivity,enterprise-search"
    });
  }
  return client;
}

export async function embedTexts(texts: string[], inputType: "query" | "document" = "document", timeoutMs = config.models.requestTimeoutMs) {
  if (!texts.length) return [];
  const result = await getClient().embeddings.generate({
    requestBody: {
      model: config.models.embedding,
      input: normalizeEmbeddingInputs(texts),
      dimensions: config.models.embeddingDimensions,
      encodingFormat: "float",
      inputType: inputType === "query" ? "query" : "passage"
    }
  }, { timeoutMs });
  if (typeof result === "string") throw new Error("OpenRouter returned an unexpected embedding response");
  return result.data
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => {
      if (typeof item.embedding === "string") throw new Error("Expected float embeddings from OpenRouter");
      return item.embedding;
    });
}

export async function rerankTexts(query: string, documents: string[], topN: number, timeoutMs = config.models.requestTimeoutMs) {
  if (!secrets.openRouterApiKey || documents.length < 2) {
    return documents.map((_, index) => ({ index, relevanceScore: 1 - index / Math.max(1, documents.length) }));
  }
  const result = await getClient().rerank.rerank({
    requestBody: {
      model: config.models.reranker,
      query,
      documents,
      topN: Math.min(topN, documents.length)
    }
  }, { timeoutMs });
  if (typeof result === "string") throw new Error("OpenRouter returned an unexpected rerank response");
  return result.results.map(({ index, relevanceScore }) => ({ index, relevanceScore }));
}

export async function validateOpenRouterModels() {
  if (!secrets.openRouterApiKey) return { healthy: false, detail: "OPENROUTER_API_KEY is missing" };
  try {
    const chatIds = new Set<string>();
    for await (const page of await getClient().models.list()) {
      const value = page as { result?: { data?: Array<{ id?: string }> }; data?: Array<{ id?: string }> };
      for (const row of value.result?.data ?? value.data ?? []) if (row.id) chatIds.add(row.id);
    }
    const embeddingIds = new Set<string>();
    for await (const page of await getClient().embeddings.listModels()) {
      const value = page as { result?: { data?: Array<{ id?: string }> }; data?: Array<{ id?: string }> };
      for (const row of value.result?.data ?? value.data ?? []) if (row.id) embeddingIds.add(row.id);
    }
    const missing = [config.models.answer, config.models.fast].filter((id) => !chatIds.has(id));
    if (!embeddingIds.has(config.models.embedding)) missing.push(config.models.embedding);
    if (missing.length) return { healthy: false, detail: `Unavailable models: ${missing.join(", ")}` };
    await getClient().rerank.rerank({
      requestBody: { model: config.models.reranker, query: "health", documents: ["health", "unrelated"], topN: 1 }
    }, { timeoutMs: config.models.requestTimeoutMs });
    return { healthy: true, detail: "Answer, extraction, embedding, and rerank models are callable" };
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : "Model validation failed" };
  }
}
