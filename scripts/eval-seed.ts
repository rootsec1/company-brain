import { config } from "../src/lib/config";

const documents = [
  {
    title: "Atlas launch decision",
    kind: "decision",
    authors: ["Maya Chen", "Luis Ortega"],
    text: "# Atlas launch decision\n\nOn 2026-09-03, Maya Chen and Luis Ortega moved the Atlas launch from September 14 to September 21. The only blocking reason was incomplete payment-service load testing. The team will keep the scope unchanged."
  },
  {
    title: "Atlas security review",
    kind: "review",
    authors: ["Priya Shah"],
    text: "# Atlas security review\n\nThe review found a server-side request forgery risk in the document preview proxy. The proxy now validates destinations against an allowlist. Priya Shah approved the remediation on September 18, clearing the security dependency for launch."
  },
  {
    title: "Customer support themes",
    kind: "report",
    authors: ["Jordan Lee"],
    text: "# Customer support themes\n\nEnterprise onboarding is most often blocked by missing self-serve SSO configuration. The product group therefore selected self-serve SSO setup as the next onboarding priority. CSV import is the second most common request."
  }
];

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, unknown>>;
}

let baseUrl = config.app.baseUrl;

async function findBaseUrl() {
  for (const candidate of config.evaluation.baseUrls) {
    try {
      const response = await fetch(`${candidate}/api/health`);
      if (response.ok || response.status === 503) return candidate;
    } catch { /* Try the next centrally configured address. */ }
  }
  throw new Error(`Aperture is unreachable at ${config.evaluation.baseUrls.join(", ")}`);
}

async function main() {
  baseUrl = await findBaseUrl();
  const health = await fetch(`${baseUrl}/api/health`);
  if (!health.ok && health.status !== 503) throw new Error(`Health endpoint returned HTTP ${health.status}`);
  const jobIds: string[] = [];
  for (const document of documents) {
    const queued = await post("/api/ingest/text", document);
    if (typeof queued.jobId !== "string") throw new Error(`Ingestion did not return a job ID for ${document.title}`);
    jobIds.push(queued.jobId);
  }

  const deadline = Date.now() + config.evaluation.ingestionTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/jobs`);
    if (!response.ok) throw new Error(`/api/jobs returned HTTP ${response.status}`);
    const body = await response.json() as { jobs?: Array<{ id: string; status: string; error?: string }> };
    const selected = new Map((body.jobs ?? []).filter((job) => jobIds.includes(job.id)).map((job) => [job.id, job]));
    const failed = [...selected.values()].find((job) => job.status === "failed");
    if (failed) throw new Error(`Evaluation ingestion ${failed.id} failed: ${failed.error ?? "unknown error"}`);
    if (jobIds.every((id) => selected.get(id)?.status === "completed")) {
      console.info(`Evaluation corpus ready (${jobIds.length} ingestion jobs completed).`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the evaluation corpus to index");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
