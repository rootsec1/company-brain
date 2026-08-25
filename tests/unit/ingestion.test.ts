import { describe, expect, it } from "vitest";
import { chunkMarkdown, formatDirectText, isCompletedContent, normalizeQueuedRecord, normalizedRecordFingerprint, shouldEnrichGraph } from "@/lib/services/ingestion";

describe("Markdown normalization", () => {
  it("deduplicates only fully indexed content so interrupted work resumes", () => {
    const base = { contentHash: "same", deletedAt: null };
    expect(isCompletedContent({ ...base, metadata: { indexStatus: "ready" } }, "same")).toBe(true);
    expect(isCompletedContent({ ...base, metadata: { indexStatus: "processing" } }, "same")).toBe(false);
    expect(isCompletedContent({ ...base, metadata: {} }, "same")).toBe(false);
    expect(isCompletedContent({ ...base, deletedAt: new Date(), metadata: { indexStatus: "ready" } }, "same")).toBe(false);
  });

  it("versions relationship and metadata changes even when Markdown is unchanged", () => {
    const base = { sourceId: "source", externalId: "record", kind: "note", title: "Record", bodyMarkdown: "same", authors: [], metadata: {}, attachments: [], relationships: [] };
    expect(normalizedRecordFingerprint(base)).not.toBe(normalizedRecordFingerprint({
      ...base, relationships: [{ fromExternalId: "record", toExternalId: "parent", type: "contained_in", metadata: {} }]
    }));
    expect(normalizedRecordFingerprint({ ...base, metadata: { rawObjectKey: "one", downloadedAt: "now" } })).toBe(
      normalizedRecordFingerprint({ ...base, metadata: { rawObjectKey: "two", downloadedAt: "later" } })
    );
  });

  it("coerces integration timestamps after BullMQ JSON serialization", () => {
    const serialized = JSON.parse(JSON.stringify({
      sourceId: "source", externalId: "message", kind: "slack_message", title: "Message", bodyMarkdown: "Hello",
      authors: [], metadata: {}, attachments: [], relationships: [],
      createdAt: new Date("2026-08-25T03:00:00.000Z"), updatedAt: new Date("2026-08-25T03:01:00.000Z")
    }));
    const normalized = normalizeQueuedRecord(serialized);
    expect(normalized.createdAt).toBeInstanceOf(Date);
    expect(normalized.updatedAt?.toISOString()).toBe("2026-08-25T03:01:00.000Z");
    expect(() => normalizedRecordFingerprint(normalized)).not.toThrow();
  });

  it("keeps short documents whole", () => {
    expect(chunkMarkdown("# Plan\n\nOne compact decision.")).toEqual([{ content: "# Plan\n\nOne compact decision.", heading: "Plan" }]);
  });

  it("chunks large documents with bounded overlap", () => {
    const chunks = chunkMarkdown(`# Context\n\n${"reliable context ".repeat(220)}`);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.content.length <= 1260)).toBe(true);
    expect(chunks.every((chunk) => chunk.heading === "Context")).toBe(true);
  });

  it("pretty-prints valid JSON and preserves malformed JSON", () => {
    expect(formatDirectText("data.json", "application/json", "{\"ok\":true}")).toContain('  "ok": true');
    expect(formatDirectText("broken.json", "application/json", "{not valid")).toContain("{not valid");
  });

  it("uses a safe Markdown fence when raw content already contains backticks", () => {
    const formatted = formatDirectText("events.log", "text/plain", "before ``` after");
    expect(formatted).toContain("````text");
    expect(formatted.endsWith("````")).toBe(true);
  });

  it("admits only substantial records to semantic graph enrichment", () => {
    expect(shouldEnrichGraph({ kind: "person" }, "x".repeat(2_000))).toBe(false);
    expect(shouldEnrichGraph({ kind: "slack_message" }, "brief update")).toBe(false);
    expect(shouldEnrichGraph({ kind: "slack_message" }, "context ".repeat(100))).toBe(true);
  });
});
