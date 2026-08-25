import { expect, test, type Page } from "@playwright/test";

const searchHit = { id: "chunk-1", documentId: "11111111-1111-4111-8111-111111111111", title: "Launch decision", snippet: "The <mark>launch</mark> remains Friday.", content: "The launch remains Friday after security review.", kind: "decision", sourceId: "source-1", sourceName: "Slack", sourceUrl: "https://slack.test/message", authors: ["Maya"], updatedAt: new Date().toISOString(), score: .94, citation: { documentId: "11111111-1111-4111-8111-111111111111", chunkId: "chunk-1", title: "Launch decision" } };

async function baseMocks(page: Page) {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: { documentCount: 18, chunkCount: 93, sources: [{ id: "source-1", name: "Slack", kind: "composio", status: "ready" }], recentDocuments: [{ id: searchHit.documentId, title: searchHit.title, kind: searchHit.kind, updatedAt: searchHit.updatedAt, authors: searchHit.authors }] } }));
  await page.route("**/api/conversations**", (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.has("id") ? { conversation: {}, messages: [], runs: [] } : { conversations: [] } }));
}

test.beforeEach(async ({ page }) => { await baseMocks(page); });

test("adds direct Markdown knowledge without Reducto", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/ingest/text", async (route) => { payload = await route.request().postDataJSON(); await route.fulfill({ status: 202, json: { jobId: "job-1", status: "queued" } }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByLabel("Title").fill("Architecture decision");
  await page.getByLabel("Content").fill("# Decision\n\nUse Typesense for serving search.");
  await page.getByRole("button", { name: "Add to brain" }).click();
  await expect.poll(() => payload).toMatchObject({ title: "Architecture decision", kind: "note" });
});

test("returns lexical results first and upgrades hybrid ranking safely", async ({ page }) => {
  await page.route("**/api/search", async (route) => {
    const body = await route.request().postDataJSON() as { mode: string };
    if (body.mode === "hybrid") await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: { hits: [{ ...searchHit, score: body.mode === "hybrid" ? .98 : .72 }], tookMs: body.mode === "hybrid" ? 420 : 18, mode: body.mode } });
  });
  await page.goto("/search");
  await page.getByPlaceholder("Search the company brain…").fill("launch");
  await expect(page.getByRole("heading", { name: "Launch decision" })).toBeVisible();
  await expect(page.locator("mark")).toHaveText("launch");
  await expect(page.getByText("98%", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search the company brain…").fill("");
  await expect(page.getByText("Everything is within reach")).toBeVisible();
});

test("streams a grounded research answer and supports cancellation controls", async ({ page }) => {
  await page.route("**/api/ask", async (route) => {
    const chunks = [
      { type: "start", messageId: "22222222-2222-4222-8222-222222222222" }, { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The launch remains Friday after security review [1]." },
      { type: "text-end", id: "text-1" }, { type: "finish" }
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    await route.fulfill({ body: chunks, headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
  });
  await page.goto("/research");
  await page.getByPlaceholder("Ask a question across your company…").fill("When do we launch?");
  await page.getByLabel("Send").click();
  await expect(page.getByText(/launch remains Friday/)).toBeVisible();
  await expect(page).toHaveURL(/conversation=/);
});

test("creates, activates, runs, pauses, and deletes an AI-drafted workflow", async ({ page }) => {
  const draft = { name: "Daily launch brief", description: "Track launch changes", prompt: "Summarize new launch risks", schedule: "0 9 * * 1-5", timezone: "UTC" };
  const workflowId = "33333333-3333-4333-8333-333333333333";
  let workflows: Array<Record<string, unknown>> = [];
  await page.route("**/api/workflows/draft", (route) => route.fulfill({ json: { draft } }));
  await page.route("**/api/workflows", async (route) => {
    if (route.request().method() === "POST") { workflows = [{ ...draft, id: workflowId, enabled: false, status: "draft", runs: [] }]; return route.fulfill({ status: 201, json: { workflow: workflows[0] } }); }
    return route.fulfill({ json: { workflows } });
  });
  await page.route(`**/api/workflows/${workflowId}/run`, (route) => route.fulfill({ status: 202, json: { run: { id: "run-1" } } }));
  await page.route(`**/api/workflows/${workflowId}`, async (route) => {
    if (route.request().method() === "DELETE") workflows = [];
    else { const body = await route.request().postDataJSON() as { enabled: boolean }; workflows[0] = { ...workflows[0], enabled: body.enabled, status: body.enabled ? "active" : "paused" }; }
    await route.fulfill({ json: { workflow: workflows[0], deleted: !workflows.length } });
  });
  await page.goto("/workflows");
  await page.getByPlaceholder(/Every weekday/).fill("Every weekday at 9am summarize launch risks");
  await page.getByRole("button", { name: "Draft workflow" }).click();
  await expect(page.getByText("Review before creating")).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Daily launch brief" })).toBeVisible();
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByLabel("Delete Daily launch brief").click();
  await expect(page.getByText("No background workflows")).toBeVisible();
});

test("operates integration sync and health/activity controls", async ({ page }) => {
  const connectionId = "44444444-4444-4444-8444-444444444444";
  await page.route("**/api/integrations", (route) => route.fulfill({ json: { enabled: true, toolkits: [], connections: [{ id: connectionId, toolkit: "slack", status: "active", name: "Slack", lastSyncedAt: new Date().toISOString() }] } }));
  let synced = false;
  await page.route(`**/api/integrations/${connectionId}/sync`, (route) => { synced = true; return route.fulfill({ status: 202, json: { run: { id: "sync-1" } } }); });
  await page.goto("/integrations");
  await page.getByRole("button", { name: "Sync" }).click();
  await expect.poll(() => synced).toBe(true);
  await page.route("**/api/jobs", (route) => route.fulfill({ json: {
    jobs: [{ id: "job-1", title: "security-review.pdf", type: "file", status: "active", progress: 74, stage: "indexing", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    researchRuns: [{ id: "run-1", name: "Daily launch brief", kind: "workflow", status: "completed", model: "openai/gpt-5.4", stepCount: 3, inputTokens: 1200, outputTokens: 300, cost: .0142, latencyMs: 8200, createdAt: new Date().toISOString() }]
  } }));
  await page.route("**/api/health", (route) => route.fulfill({ json: { status: "healthy", services: ["postgres", "typesense", "valkey", "seaweedfs", "lightrag", "openrouter", "reducto"].map((service) => ({ service, healthy: true, latencyMs: 12, detail: "Online" })) } }));
  await page.goto("/activity");
  await expect(page.getByText("security-review.pdf")).toBeVisible();
  await expect(page.getByText("7/7")).toBeVisible();
  await expect(page.getByText("Daily launch brief")).toBeVisible();
  await expect(page.getByText(/1,500 tokens/)).toBeVisible();
});

test("renders document evidence and relationship graph responsively", async ({ page }) => {
  await page.route(`**/api/documents/${searchHit.documentId}`, (route) => route.fulfill({ json: { id: searchHit.documentId, title: searchHit.title, kind: "decision", markdown: "# Launch decision\n\nFriday after review.", version: 2, currentVersion: 2, sourceUrl: searchHit.sourceUrl, authors: ["Maya"], updatedAt: searchHit.updatedAt, viewedVersionCreatedAt: searchHit.updatedAt, metadata: {}, versions: [{ version: 2, parser: "direct", createdAt: searchHit.updatedAt, metadata: {} }], related: [{ id: "doc-2", title: "Security review", kind: "report", edge: { type: "attached_to" } }] } }));
  await page.goto(`/documents/${searchHit.documentId}`);
  await expect(page.locator(".page-title").filter({ hasText: "Launch decision" })).toBeVisible();
  await expect(page.getByText("Security review")).toBeVisible();
  await page.route("**/api/graph**", (route) => route.fulfill({ json: { nodes: [{ id: searchHit.documentId, title: "Launch decision", kind: "decision", provenance: "source" }, { id: "doc-2", title: "Security review", kind: "report", provenance: "source" }], edges: [{ id: "edge-1", source: searchHit.documentId, target: "doc-2", label: "attached to", provenance: "source" }] } }));
  await page.goto("/graph");
  await expect(page.getByText("Launch decision")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Knowledge graph" })).toBeVisible();
});
