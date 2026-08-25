import { config } from "../src/lib/config";

type Job = { id: string; status: string; documentId?: string; error?: string };

async function reachableBaseUrl() {
  for (const candidate of config.evaluation.baseUrls) {
    try {
      const response = await fetch(`${candidate}/api/health`);
      if (response.ok || response.status === 503) return candidate;
    } catch { /* Try the next centrally configured address. */ }
  }
  throw new Error(`Aperture is unreachable at ${config.evaluation.baseUrls.join(", ")}`);
}

async function waitForJobs(baseUrl: string, ids: string[]) {
  const deadline = Date.now() + config.evaluation.ingestionTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/jobs`);
    const body = await response.json() as { jobs: Job[] };
    const selected = new Map(body.jobs.filter((job) => ids.includes(job.id)).map((job) => [job.id, job]));
    const failed = [...selected.values()].find((job) => job.status === "failed");
    if (failed) throw new Error(failed.error ?? `Graph evaluation job ${failed.id} failed`);
    if (ids.every((id) => selected.get(id)?.status === "completed")) return selected;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for graph evaluation ingestion");
}

const baseUrl = await reachableBaseUrl();
const suffix = Date.now().toString(36);
const cases = ["Kestrel", "Juniper", "Solstice"].map((name, index) => ({
  project: `${name}-${suffix}`,
  owner: `OWNER-${index + 1}-${suffix}`
}));
let baselineCorrect = 0;
let graphCorrect = 0;

for (const [index, item] of cases.entries()) {
  const rootId = `graph-root-${suffix}-${index}`;
  const replyId = `graph-reply-${suffix}-${index}`;
  const response = await fetch(`${baseUrl}/api/ingest/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      channel: `graph-eval-${suffix}-${index}`,
      messages: [
        { id: rootId, text: `Project ${item.project} is ready for ownership review.`, userName: "Program office" },
        { id: replyId, text: `The accountable owner token is ${item.owner}.`, userName: "Operations", threadId: rootId }
      ]
    })
  });
  if (response.status !== 202) throw new Error(`Message ingestion returned HTTP ${response.status}: ${await response.text()}`);
  const queued = await response.json() as { jobs: Array<{ jobId: string; externalId: string }> };
  const jobs = await waitForJobs(baseUrl, queued.jobs.map((job) => job.jobId));
  const rootJobId = queued.jobs.find((job) => job.externalId === rootId)?.jobId;
  const replyJobId = queued.jobs.find((job) => job.externalId === replyId)?.jobId;
  const rootDocumentId = rootJobId ? jobs.get(rootJobId)?.documentId : undefined;
  const replyDocumentId = replyJobId ? jobs.get(replyJobId)?.documentId : undefined;
  if (!rootDocumentId || !replyDocumentId) throw new Error("Graph evaluation did not resolve both message documents");

  const searchResponse = await fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: item.project, mode: "lexical", limit: 10 })
  });
  const search = await searchResponse.json() as { hits: Array<{ content: string }> };
  if (search.hits.some((hit) => hit.content.includes(item.owner))) baselineCorrect += 1;

  const graphResponse = await fetch(`${baseUrl}/api/graph?documentId=${rootDocumentId}`);
  const graph = await graphResponse.json() as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string; type?: string }> };
  const followsReply = graph.nodes.some((node) => node.id === replyDocumentId)
    && graph.edges.some((edge) => edge.type === "reply_to" && [edge.source, edge.target].includes(replyDocumentId));
  const relatedResponse = await fetch(`${baseUrl}/api/documents/${replyDocumentId}`);
  const related = await relatedResponse.json() as { markdown?: string };
  if (followsReply && related.markdown?.includes(item.owner)) graphCorrect += 1;
}

const baselineAccuracy = baselineCorrect / cases.length * 100;
const graphAccuracy = graphCorrect / cases.length * 100;
const improvementPoints = graphAccuracy - baselineAccuracy;
console.info(JSON.stringify({ cases: cases.length, baselineAccuracy, graphAccuracy, improvementPoints }));
if (improvementPoints < config.evaluation.graphMinimumImprovementPoints) {
  throw new Error(`Graph improvement ${improvementPoints.toFixed(1)} points is below the configured ${config.evaluation.graphMinimumImprovementPoints}-point threshold`);
}
