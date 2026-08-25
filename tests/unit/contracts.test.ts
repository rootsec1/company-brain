import { describe, expect, it } from "vitest";
import { normalizedRecordSchema, searchRequestSchema } from "@/lib/contracts";
import { isReadOnlyToolSlug } from "@/lib/integrations/composio";
import { validUuid } from "@/lib/http";

describe("canonical contracts", () => {
  it("rejects malformed resource identifiers before database queries", () => {
    expect(validUuid("not-an-id")).toBe(false);
    expect(validUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });
  it("normalizes defaults without losing relationship provenance", () => {
    const record = normalizedRecordSchema.parse({
      sourceId: "slack", externalId: "message-2", kind: "message", title: "Decision", bodyMarkdown: "Ship on Friday",
      relationships: [{ fromExternalId: "message-2", toExternalId: "message-1", type: "reply_to" }]
    });
    expect(record.authors).toEqual([]);
    expect(record.relationships[0]).toMatchObject({ type: "reply_to", metadata: {} });
  });

  it("coerces date filters and applies safe search limits", () => {
    const request = searchRequestSchema.parse({ query: " launch plan ", dateFrom: "2026-01-01", limit: 10 });
    expect(request.query).toBe("launch plan");
    expect(request.dateFrom).toBeInstanceOf(Date);
    expect(() => searchRequestSchema.parse({ query: "x", limit: 500 })).toThrow();
  });
});

describe("Composio policy", () => {
  it("allows retrieval tools and rejects mutation-shaped tools", () => {
    expect(isReadOnlyToolSlug("SLACK_SEARCH_MESSAGES")).toBe(true);
    expect(isReadOnlyToolSlug("GITHUB_GET_REPOSITORY")).toBe(true);
    expect(isReadOnlyToolSlug("GMAIL_SEND_EMAIL")).toBe(false);
    expect(isReadOnlyToolSlug("NOTION_UPDATE_PAGE")).toBe(false);
    expect(isReadOnlyToolSlug("SLACK_SEARCH_AND_SEND_MESSAGE")).toBe(false);
  });
});
