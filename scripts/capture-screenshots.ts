import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page, type Route } from "@playwright/test";
import { config } from "../src/lib/config";

const outputDirectory = resolve(process.argv[2] ?? "test-results/visual-audit");
const baseUrl = process.argv[3] ?? config.app.baseUrl.replace("localhost", "127.0.0.1");
const useDemoData = process.env.APERTURE_SCREENSHOT_DEMO === "1";
const now = new Date("2026-08-25T14:30:00.000Z");
const documentId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

const documents = [
  { id: documentId, title: "Project Helios launch decision", kind: "decision", sourceName: "Slack", sourceId: "slack", authors: ["Maya Chen", "Owen Park"], content: "Project Helios will launch to 20% of enterprise workspaces on September 12 after security approval. The rollout expands after a seven-day reliability window.", updatedAt: now.toISOString() },
  { id: "33333333-3333-4333-8333-333333333333", title: "Helios security readiness review", kind: "report", sourceName: "Google Drive", sourceId: "drive", authors: ["Priya Shah"], content: "All critical findings are closed. The remaining medium-severity item is mitigated by scoped tokens and audit logging.", updatedAt: "2026-08-24T18:12:00.000Z" },
  { id: "44444444-4444-4444-8444-444444444444", title: "Enterprise rollout playbook", kind: "document", sourceName: "Notion", sourceId: "notion", authors: ["Revenue Operations"], content: "The launch cohort includes 42 design partners across financial services, developer tooling, and healthcare.", updatedAt: "2026-08-23T11:45:00.000Z" },
  { id: "55555555-5555-4555-8555-555555555555", title: "Q3 reliability targets", kind: "policy", sourceName: "Confluence", sourceId: "confluence", authors: ["Platform"], content: "The release gate requires 99.95% successful retrieval, a p95 search first paint below 200ms, and no unresolved severity-one incidents.", updatedAt: "2026-08-22T09:20:00.000Z" },
  { id: "66666666-6666-4666-8666-666666666666", title: "Customer council — August notes", kind: "meeting", sourceName: "Google Drive", sourceId: "drive", authors: ["Leah Kim"], content: "Customers consistently described relationship-aware search and traceable answers as the deciding capabilities.", updatedAt: "2026-08-21T16:05:00.000Z" }
];

const hits = documents.map((document, index) => ({
  ...document,
  id: `chunk-${index + 1}`,
  documentId: document.id,
  snippet: document.content.replace(/Helios/gi, "<mark>Helios</mark>"),
  score: 0.98 - index * 0.035,
  sourceUrl: `https://example.com/${document.sourceId}/${document.id}`,
  citation: { documentId: document.id, chunkId: `chunk-${index + 1}`, title: document.title }
}));

const connections = [
  { id: "conn-slack", toolkit: "slack", status: "active", name: "Slack", lastSyncedAt: now.toISOString() },
  { id: "conn-drive", toolkit: "googledrive", status: "active", name: "Google Drive", lastSyncedAt: "2026-08-25T14:27:00.000Z" },
  { id: "conn-notion", toolkit: "notion", status: "active", name: "Notion", lastSyncedAt: "2026-08-25T14:19:00.000Z" }
];

const toolkitCatalog = [
  ["slack", "Slack", "Threads, messages, files, channels, authors, and mentions."],
  ["googledrive", "Google Drive", "Documents, folders, permissions, versions, and comments."],
  ["notion", "Notion", "Pages, databases, blocks, people, and nested workspace context."],
  ["github", "GitHub", "Repositories, issues, pull requests, discussions, and code context."],
  ["confluence", "Confluence", "Spaces, pages, comments, attachments, and page history."],
  ["jira", "Jira", "Projects, issues, comments, relationships, and delivery context."],
  ["linear", "Linear", "Teams, projects, initiatives, issues, and customer requests."],
  ["gmail", "Gmail", "Read-only mail, threads, attachments, labels, and participants."],
  ["sharepoint", "SharePoint", "Sites, libraries, folders, Office files, and metadata."],
  ["onedrive", "OneDrive", "Files, folders, versions, and shared-drive relationships."],
  ["dropbox", "Dropbox", "Files, Paper documents, folders, and sharing metadata."],
  ["box", "Box", "Enterprise files, folders, comments, and version history."]
].map(([slug, name, description]) => ({
  slug,
  name,
  description,
  logo: ({
    slack: "https://api.iconify.design/logos:slack-icon.svg",
    sharepoint: "https://api.iconify.design/streamline-logos:microsoft-sharepoint-logo-block.svg",
    onedrive: "https://api.iconify.design/logos:microsoft-onedrive.svg"
  } as Record<string, string>)[slug] ?? `https://cdn.simpleicons.org/${slug}`,
  toolsCount: 42,
  categories: ["productivity"],
  optimized: true,
  noAuth: false
}));

function fulfill(route: Route, json: unknown) {
  return route.fulfill({ json, headers: { "cache-control": "no-store" } });
}

async function installDemoData(page: Page) {
  await page.route("**/api/dashboard", (route) => fulfill(route, {
    documentCount: 28419,
    chunkCount: 176204,
    sources: connections.map((connection) => ({ id: connection.id, name: connection.name, kind: "composio", status: "ready" })),
    recentDocuments: documents
  }));
  await page.route("**/api/search", (route) => fulfill(route, { hits, tookMs: 84, mode: "hybrid", total: 127 }));
  await page.route("**/api/conversations**", (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("id")) return fulfill(route, { conversations: [
      { id: conversationId, title: "What is blocking the Helios launch?", updatedAt: now.toISOString() },
      { id: "research-2", title: "Enterprise themes from customer calls", updatedAt: "2026-08-24T16:40:00.000Z" },
      { id: "research-3", title: "Contradictions in current security policy", updatedAt: "2026-08-23T09:10:00.000Z" }
    ] });
    return fulfill(route, { messages: [
      { id: "message-user", role: "user", parts: [{ type: "text", text: "What is blocking the Helios launch, and is the September 12 date still credible?" }] },
      { id: "message-assistant", role: "assistant", parts: [
        { type: "tool-search_chunks", toolCallId: "tool-1", state: "output-available", input: { query: "Helios launch blockers" }, output: hits.slice(0, 4) },
        { type: "text", text: "## The launch is on track\n\nThe **September 12** date remains credible. Security has closed every critical finding, and the only remaining medium-severity item is mitigated by scoped tokens and audit logging [1][2].\n\nThe rollout is intentionally staged: **20% of enterprise workspaces first**, followed by a seven-day reliability window. The gate is 99.95% successful retrieval and p95 search below 200ms [3][4].\n\n### Watch closely\n\n- Validate the final audit-log export with the 42-member design-partner cohort.\n- Keep the rollout frozen if a severity-one incident appears.\n- Reconcile the older July launch note, which still references September 5.\n\n**Confidence: high.** Four independent sources agree on the current plan." }
      ] }
    ] });
  });
  await page.route("**/api/graph**", (route) => fulfill(route, {
    semanticAvailable: true,
    nodes: [
      { id: documentId, title: "Helios launch", kind: "decision", provenance: "source" },
      { id: "security", title: "Security readiness", kind: "report", provenance: "source" },
      { id: "rollout", title: "Rollout playbook", kind: "document", provenance: "source" },
      { id: "reliability", title: "Reliability targets", kind: "policy", provenance: "source" },
      { id: "council", title: "Customer council", kind: "meeting", provenance: "source" },
      { id: "slack-thread", title: "#project-helios", kind: "thread", provenance: "source" },
      { id: "enterprise", title: "Enterprise adoption", kind: "theme", provenance: "semantic" },
      { id: "trust", title: "Evidence & trust", kind: "concept", provenance: "semantic" },
      { id: "staged", title: "Staged deployment", kind: "strategy", provenance: "semantic" },
      { id: "risk", title: "Operational risk", kind: "concept", provenance: "semantic" }
    ],
    edges: [
      { id: "e1", source: documentId, target: "security", label: "depends on", provenance: "source" },
      { id: "e2", source: documentId, target: "rollout", label: "implemented by", provenance: "source" },
      { id: "e3", source: documentId, target: "slack-thread", label: "decided in", provenance: "source" },
      { id: "e4", source: "rollout", target: "council", label: "informed by", provenance: "source" },
      { id: "e5", source: "rollout", target: "reliability", label: "gated by", provenance: "source" },
      { id: "e6", source: "enterprise", target: "trust", label: "requires", provenance: "semantic" },
      { id: "e7", source: "staged", target: "risk", label: "reduces", provenance: "semantic" },
      { id: "e8", source: "trust", target: "risk", label: "makes visible", provenance: "semantic" }
    ]
  }));
  await page.route("**/api/integrations", (route) => fulfill(route, { enabled: true, toolkits: toolkitCatalog, connections }));
  await page.route("**/api/workflows/draft", (route) => fulfill(route, { draft: {
    name: "Daily launch intelligence",
    description: "Track new decisions, risks, and contradictions across every connected source.",
    prompt: "Summarize new Helios decisions, risks, contradictions, and named next actions with stable citations.",
    schedule: "0 9 * * 1-5",
    timezone: "UTC",
    output: "markdown"
  } }));
  await page.route("**/api/workflows", (route) => fulfill(route, { workflows: [
    { id: "workflow-1", name: "Daily launch intelligence", description: "Track launch risk", prompt: "Summarize new Helios decisions, risks, and contradictions with evidence.", schedule: "0 9 * * 1-5", timezone: "UTC", enabled: true, status: "active", nextRunAt: "2026-08-26T09:00:00.000Z", runs: [{ id: "run-1", status: "completed", trigger: "schedule", createdAt: "2026-08-25T09:00:00.000Z", latencyMs: 6830 }, { id: "run-2", status: "completed", trigger: "schedule", createdAt: "2026-08-24T09:00:00.000Z", latencyMs: 7140 }] },
    { id: "workflow-2", name: "Customer signal radar", description: "Find themes", prompt: "Find recurring product requests and newly emerging customer pain across calls and support.", schedule: "30 8 * * 1", timezone: "UTC", enabled: true, status: "active", nextRunAt: "2026-08-31T08:30:00.000Z", runs: [{ id: "run-3", status: "completed", trigger: "schedule", createdAt: "2026-08-24T08:30:00.000Z", latencyMs: 9210 }] }
  ] }));
  await page.route("**/api/jobs", (route) => fulfill(route, {
    jobs: [
      { id: "job-1", title: "security-readiness.pdf", type: "file", status: "completed", progress: 100, stage: "indexed", createdAt: "2026-08-25T14:12:00.000Z", updatedAt: "2026-08-25T14:13:00.000Z" },
      { id: "job-2", title: "Slack · #project-helios", type: "sync", status: "active", progress: 74, stage: "preserving relationships", createdAt: "2026-08-25T14:28:00.000Z", updatedAt: now.toISOString() },
      { id: "job-3", title: "Customer council notes", type: "graph", status: "completed", progress: 100, stage: "semantic graph ready", createdAt: "2026-08-25T14:05:00.000Z", updatedAt: "2026-08-25T14:07:00.000Z" }
    ],
    researchRuns: [{ id: "run-1", name: "Daily launch intelligence", kind: "workflow", status: "completed", model: "openai/gpt-5.4", stepCount: 5, inputTokens: 18420, outputTokens: 864, cost: 0.0421, latencyMs: 6830, createdAt: "2026-08-25T09:00:00.000Z" }]
  }));
  await page.route("**/api/health", (route) => fulfill(route, { status: "healthy", services: ["postgres", "typesense", "valkey", "seaweedfs", "lightrag", "openrouter", "reducto"].map((service, index) => ({ service, healthy: true, latencyMs: 7 + index * 4, detail: "Online" })) }));
  await page.route(`**/api/documents/${documentId}`, (route) => fulfill(route, {
    id: documentId,
    title: "Project Helios launch decision",
    kind: "decision",
    markdown: "# Project Helios launch decision\n\n> **Status:** Approved for staged rollout on September 12.\n\n## Decision\n\nLaunch to **20% of enterprise workspaces** after the security sign-off, then expand after a seven-day reliability window.\n\n| Release gate | Target | Current |\n| --- | ---: | ---: |\n| Successful retrieval | 99.95% | 99.97% |\n| Search first paint p95 | < 200 ms | 84 ms |\n| Severity-one incidents | 0 | 0 |\n\n## Why now\n\nDesign partners consistently identified relationship-aware search and traceable answers as the capabilities that turn company knowledge into decisions.\n\n## Guardrails\n\n- Scoped tokens and complete audit logging\n- Read-only integration access\n- Immediate rollback if reliability gates regress",
    version: 4,
    currentVersion: 4,
    sourceUrl: "https://example.com/slack/project-helios",
    authors: ["Maya Chen", "Owen Park"],
    updatedAt: now.toISOString(),
    viewedVersionCreatedAt: now.toISOString(),
    metadata: { channel: "project-helios", confidence: "high" },
    versions: [{ version: 4, parser: "direct", createdAt: now.toISOString(), metadata: {} }, { version: 3, parser: "direct", createdAt: "2026-08-18T12:00:00.000Z", metadata: {} }],
    related: documents.slice(1, 5).map((document, index) => ({ id: document.id, title: document.title, kind: document.kind, edge: { type: ["attached_to", "links_to", "depends_on", "mentioned_in"][index] } }))
  }));
}

async function capture(page: Page, name: string, path: string, options: { fullPage?: boolean; prepare?: (page: Page) => Promise<void> } = {}) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await options.prepare?.(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(outputDirectory, `${name}.jpg`), type: "jpeg", quality: 88, fullPage: options.fullPage ?? true });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  desktop.on("pageerror", (error) => errors.push(error.message));
  if (useDemoData) await installDemoData(desktop);
  await capture(desktop, "aperture-home", "/");
  await capture(desktop, "aperture-search", "/search?q=Helios");
  await capture(desktop, "aperture-research", `/research?conversation=${conversationId}`);
  await capture(desktop, "aperture-graph", "/graph");
  await capture(desktop, "aperture-integrations", "/integrations");
  await capture(desktop, "aperture-activity", "/activity");
  await capture(desktop, "aperture-workflows", "/workflows", { prepare: async (page) => {
    await page.getByPlaceholder(/Every weekday/).fill("Every weekday at 9am, summarize new launch risks and contradictions");
    await page.getByRole("button", { name: "Draft workflow" }).click();
    await page.getByText("Review before creating").waitFor();
  } });

  let selectedDocumentId = documentId;
  if (!useDemoData) {
    const searchResponse = await desktop.request.post(`${baseUrl}/api/search`, { data: { query: "Helios", mode: "lexical", limit: 1 } });
    const search = await searchResponse.json() as { hits?: Array<{ documentId: string }> };
    selectedDocumentId = search.hits?.[0]?.documentId ?? documentId;
  }
  await capture(desktop, "aperture-document", `/documents/${selectedDocumentId}`);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on("pageerror", (error) => errors.push(error.message));
  if (useDemoData) await installDemoData(mobile);
  await capture(mobile, "aperture-mobile-home", "/", { fullPage: false });
  await capture(mobile, "aperture-mobile-search", "/search?q=Helios", { fullPage: false });

  if (errors.length) throw new Error(`Browser errors: ${[...new Set(errors)].join("; ")}`);
  console.info(`Saved visual audit evidence to ${outputDirectory}`);
} finally {
  await browser.close();
}
