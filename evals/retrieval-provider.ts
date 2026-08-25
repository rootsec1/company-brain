import rawConfig from "../config/consts.json";

type ProviderOptions = { vars?: Record<string, string> };

async function reachableBaseUrl() {
  for (const candidate of rawConfig.evaluation.baseUrls) {
    const baseUrl = candidate.replace(/\/$/, "");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok || response.status === 503) return baseUrl;
    } catch { /* Try the next centrally configured address. */ }
  }
  throw new Error(`Aperture is unreachable at ${rawConfig.evaluation.baseUrls.join(", ")}`);
}

export default class RetrievalProvider {
  id() { return "aperture-retrieval"; }
  async callApi(prompt: string, context: ProviderOptions) {
    const query = context.vars?.query ?? prompt;
    const baseUrl = await reachableBaseUrl();
    const response = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, mode: "agent", limit: 10 })
    });
    if (!response.ok) return { error: `Search returned HTTP ${response.status}` };
    const body = await response.json() as { hits: unknown[] };
    return { output: JSON.stringify(body.hits) };
  }
}
