import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test.skip(process.env.RUN_LIVE_STACK_E2E !== "1", "Requires the complete service stack and live provider keys");
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const base = "http://127.0.0.1:3000";

async function waitForJob(request: APIRequestContext, jobId: string) {
  let found: { status: string; documentId?: string; error?: string } | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${base}/api/jobs`);
    const body = await response.json() as { jobs: Array<{ id: string; status: string; documentId?: string; error?: string }> };
    found = body.jobs.find((job) => job.id === jobId);
    return found?.status;
  }, { timeout: 120_000, intervals: [250, 500, 1000] }).toMatch(/completed|failed/);
  expect(found?.status, found?.error).toBe("completed");
  expect(found?.documentId).toBeTruthy();
  return found!.documentId!;
}

test("runs the service-backed knowledge, graph, and research journey", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sourceUrl = `https://example.com/live-audit/${suffix}`;
  const firstMarker = `ORCHID-${suffix}`;
  const currentMarker = `COBALT-${suffix}`;

  const health = await request.get(`${base}/api/health`);
  expect(health.ok()).toBe(true);
  const healthBody = await health.json() as { status: string; services: Array<{ service: string; healthy: boolean }> };
  expect(healthBody.status).toBe("healthy");
  expect(healthBody.services.every((service) => service.healthy)).toBe(true);

  const first = await request.post(`${base}/api/ingest/text`, { data: {
    title: `Live audit decision ${suffix}`,
    text: `# Launch decision\n\nThe first marker is ${firstMarker}. Project Helios launches on November 18.`,
    kind: "decision", sourceUrl, authors: ["Maya Chen"]
  } });
  expect(first.status()).toBe(202);
  await waitForJob(request, (await first.json()).jobId);

  const update = await request.post(`${base}/api/ingest/text`, { data: {
    title: `Live audit decision ${suffix}`,
    text: `# Launch decision\n\nThe current marker is ${currentMarker}. Project Helios launches on November 21 after security approval.`,
    kind: "decision", sourceUrl, authors: ["Maya Chen"]
  } });
  const documentId = await waitForJob(request, (await update.json()).jobId);

  const document = await request.get(`${base}/api/documents/${documentId}`);
  const current = await document.json() as { version: number; currentVersion: number; versions: Array<{ version: number }>; metadata: Record<string, unknown> };
  expect(current.version).toBe(2);
  expect(current.versions.map((version) => version.version)).toEqual([2, 1]);
  await expect.poll(async () => {
    const value = await (await request.get(`${base}/api/documents/${documentId}`)).json() as { metadata: { graphStatus?: string } };
    return value.metadata.graphStatus;
  }, { timeout: 120_000, intervals: [500, 1000, 2000] }).toMatch(/success|processed|reused/);

  const oldSearch = await request.post(`${base}/api/search`, { data: { query: firstMarker, mode: "lexical", limit: 5 } });
  expect((await oldSearch.json()).hits).toHaveLength(0);

  await page.goto(`/search?q=${encodeURIComponent(currentMarker)}`);
  await expect(page.getByRole("heading", { name: `Live audit decision ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("heading", { name: `Live audit decision ${suffix}` }).click();
  await expect(page.getByText(currentMarker)).toBeVisible();
  await expect(page.getByLabel("Version history")).toHaveValue("2");
  await page.getByLabel("Version history").selectOption("1");
  await expect(page.getByText(firstMarker)).toBeVisible();
  await expect(page.getByText("Historical · v1")).toBeVisible();

  const messageRoot = `msg-root-${suffix}`;
  const messageReply = `msg-reply-${suffix}`;
  const messages = await request.post(`${base}/api/ingest/messages`, { data: {
    channel: `helios-${suffix}`,
    messages: [
      { id: messageRoot, text: `Helios rollout is approved. <@U-HELIOS> owns delivery.`, user: "U-MAYA", userName: "Maya Chen" },
      { id: messageReply, text: "Acknowledged; the runbook is final.", user: "U-HELIOS", userName: "Theo Martin", threadId: messageRoot }
    ]
  } });
  expect(messages.status()).toBe(202);
  const messageJobs = (await messages.json()).jobs as Array<{ jobId: string; externalId: string }>;
  const resolved = new Map<string, string>();
  for (const job of messageJobs) resolved.set(job.externalId, await waitForJob(request, job.jobId));
  const replyDocumentId = resolved.get(messageReply)!;
  const graph = await request.get(`${base}/api/graph?documentId=${replyDocumentId}`);
  const graphBody = await graph.json() as { semanticAvailable: boolean; nodes: Array<{ title: string }>; edges: Array<{ type?: string }> };
  expect(graphBody.nodes.some((node) => node.title.includes(`helios-${suffix}`))).toBe(true);
  expect(graphBody.edges.map((edge) => edge.type)).toEqual(expect.arrayContaining(["reply_to", "in_thread", "authored_by", "contained_in"]));
  await expect.poll(async () => {
    const currentGraph = await (await request.get(`${base}/api/graph`)).json() as { semanticAvailable: boolean };
    return currentGraph.semanticAvailable;
  }, { timeout: 120_000, intervals: [1000, 2000, 3000] }).toBe(true);

  await page.goto(`/research?q=${encodeURIComponent(`What is the current ${currentMarker} launch date for Helios?`)}`);
  await expect(page.locator(".message.assistant .message-copy").getByText(/November 21/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: new RegExp(`Live audit decision ${suffix}`) }).first()).toBeVisible();
});

test("executes and controls a real bounded scheduled research workflow", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const marker = `WORKFLOW-${suffix}`;
  const ingest = await request.post(`${base}/api/ingest/text`, { data: {
    title: `Workflow evidence ${suffix}`, text: `# Evidence\n\nThe verified workflow marker is ${marker}.`, kind: "note"
  } });
  await waitForJob(request, (await ingest.json()).jobId);

  const created = await request.post(`${base}/api/workflows`, { data: {
    name: `Live workflow ${suffix}`, description: "Live service-backed workflow",
    prompt: `Find the exact marker ${marker} and report it with its source citation.`,
    schedule: "0 9 * * 1-5", timezone: "UTC"
  } });
  expect(created.status()).toBe(201);
  const workflowId = (await created.json()).workflow.id as string;
  expect((await request.patch(`${base}/api/workflows/${workflowId}`, { data: { enabled: true } })).ok()).toBe(true);
  const run = await request.post(`${base}/api/workflows/${workflowId}/run`);
  const runId = (await run.json()).run.id as string;

  await expect.poll(async () => {
    const value = await (await request.get(`${base}/api/workflows`)).json() as { workflows: Array<{ id: string; runs: Array<{ id: string; status: string; answer?: string }> }> };
    return value.workflows.find((workflow) => workflow.id === workflowId)?.runs.find((item) => item.id === runId)?.status;
  }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toBe("completed");

  const workflows = await (await request.get(`${base}/api/workflows`)).json() as { workflows: Array<{ id: string; runs: Array<{ id: string; answer?: string; inputTokens: number; cost?: number }> }> };
  const finished = workflows.workflows.find((workflow) => workflow.id === workflowId)!.runs.find((item) => item.id === runId)!;
  expect(finished.answer).toContain(marker);
  expect(finished.inputTokens).toBeGreaterThan(0);
  expect(finished.cost).toBeGreaterThan(0);

  await page.goto("/workflows");
  const card = page.getByRole("heading", { name: `Live workflow ${suffix}` }).locator("xpath=ancestor::article");
  await expect(card.getByText("active", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText("paused", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: `Delete Live workflow ${suffix}` }).click();
  await expect(page.getByRole("heading", { name: `Live workflow ${suffix}` })).toHaveCount(0);
});

test("exposes only the six read-only research tools over MCP", async () => {
  const client = new Client({ name: "aperture-live-verifier", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  await client.connect(transport);
  try {
    const available = await client.listTools();
    expect(available.tools.map((tool) => tool.name).sort()).toEqual([
      "find_related",
      "get_document",
      "get_graph_context",
      "live_source_search",
      "search_chunks",
      "traverse_source_graph"
    ]);
    const result = await client.callTool({ name: "search_chunks", arguments: { query: "Helios", limit: 3 } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));
  } finally {
    await client.close();
  }
});
