import { describe, expect, it } from "vitest";
import slackFixture from "../fixtures/composio/slack-history.json";
import driveFixture from "../fixtures/composio/drive-files.json";
import notionFixture from "../fixtures/composio/notion-search.json";
import issuesFixture from "../fixtures/composio/issues.json";
import genericFixture from "../fixtures/composio/generic-records.json";
import { composioToolResponseSchema, normalizeComposioResponse, type ComposioToolResponse } from "@/lib/integrations/normalizers";
import { selectReadTool } from "@/lib/integrations/composio";
import { advanceComposioCursor, extractComposioCursors, safeDownloadedPaths } from "@/lib/integrations/sync";

describe("Composio response contracts", () => {
  it.each([slackFixture, driveFixture, notionFixture, issuesFixture, genericFixture])("matches the official SDK execution envelope", (fixture) => {
    expect(composioToolResponseSchema.safeParse(fixture).success).toBe(true);
  });

  it("preserves Slack threads and attachment relationships", () => {
    const records = normalizeComposioResponse("slack", "source-1", slackFixture as ComposioToolResponse);
    expect(records).toHaveLength(6);
    const message = records.find((record) => record.externalId === "1787616000.000100");
    expect(message?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reply_to", toExternalId: "1787615000.000001" }),
      expect.objectContaining({ type: "in_thread", toExternalId: "1787615000.000001" }),
      expect.objectContaining({ type: "authored_by", toExternalId: "slack-user:U123" }),
      expect.objectContaining({ type: "contained_in", toExternalId: "slack-channel:C01" })
    ]));
    expect(records.find((record) => record.externalId === "F123")?.relationships[0]).toMatchObject({ type: "attached_to", toExternalId: "1787616000.000100" });
    expect(records.find((record) => record.externalId === "slack-user:U123")).toMatchObject({ kind: "person", title: "Maya" });
  });

  it("preserves folder and page containment", () => {
    const drive = normalizeComposioResponse("googledrive", "source-1", driveFixture as ComposioToolResponse);
    const notion = normalizeComposioResponse("notion", "source-1", notionFixture as ComposioToolResponse);
    expect(drive[0].relationships[0]).toMatchObject({ type: "contained_in", toExternalId: "drive-folder-1" });
    expect(notion[0].relationships[0]).toMatchObject({ type: "contained_in", toExternalId: "notion-parent-1" });
  });

  it.each(["github", "jira", "linear", "confluence", "gmail"])("normalizes %s issue-like records", (toolkit) => {
    const [record] = normalizeComposioResponse(toolkit, "source-1", issuesFixture as ComposioToolResponse);
    expect(record.title).toBe("Resolve launch blocker");
    expect(record.bodyMarkdown).toContain("Approved after review");
  });

  it.each(["onedrive", "sharepoint", "dropbox", "box"])("normalizes %s file records", (toolkit) => {
    const records = normalizeComposioResponse(toolkit, "source-1", driveFixture as ComposioToolResponse);
    expect(records[0]).toMatchObject({ externalId: "drive-doc-1", title: "Launch plan" });
  });

  it("provides a lossless generic fallback for any other toolkit", () => {
    const [record] = normalizeComposioResponse("unknown_crm", "source-1", genericFixture as ComposioToolResponse);
    expect(record.bodyMarkdown).toContain("Customer escalation");
    expect(record.metadata).toMatchObject({ id: "record-1" });
  });

  it("rejects unsuccessful tool executions", () => {
    expect(() => normalizeComposioResponse("slack", "source-1", { data: {}, error: "rate limited", successful: false })).toThrow("rate limited");
  });

  it("normalizes upstream deletion signals into tombstones", () => {
    const [record] = normalizeComposioResponse("googledrive", "source-1", { data: { files: [{ id: "gone", name: "Gone", removed: true }] }, error: null, successful: true });
    expect(record.deletedAt).toBeInstanceOf(Date);
  });

  it("selects only read tools and honors optimized profiles", () => {
    const selected = selectReadTool([
      { slug: "SLACK_SEND_MESSAGE" },
      { slug: "SLACK_LIST_CHANNELS" },
      { slug: "SLACK_SEARCH_MESSAGES" }
    ], ["SLACK_LIST_CHANNELS"]);
    expect(selected?.slug).toBe("SLACK_LIST_CHANNELS");
  });

  it("distinguishes page cursors from durable delta cursors", () => {
    expect(extractComposioCursors({ successful: true, error: null, data: { next_cursor: "page-2", new_start_page_token: "delta-next" } })).toEqual({
      page: "page-2", durable: "delta-next"
    });
    expect(advanceComposioCursor("delta-current", { successful: true, error: null, data: {} }, false)).toEqual({
      nextPage: null, durable: "delta-current"
    });
    expect(advanceComposioCursor("delta-current", { successful: true, error: null, data: { next_cursor: "page-10" } }, true)).toEqual({
      nextPage: "page-10", durable: "page-10"
    });
  });

  it("accepts only SDK-downloaded paths inside the configured temporary directory", () => {
    expect(safeDownloadedPaths({ file: "/tmp/aperture-composio-downloads/report.pdf", unsafe: "/etc/passwd" })).toEqual([
      "/tmp/aperture-composio-downloads/report.pdf"
    ]);
  });
});
