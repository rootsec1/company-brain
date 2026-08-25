import { describe, expect, it } from "vitest";
import { normalizeEmbeddingInputs } from "@/lib/services/openrouter";

describe("OpenRouter embedding inputs", () => {
  it("preserves cardinality and replaces parser-emitted empty chunks", () => {
    expect(normalizeEmbeddingInputs(["evidence", "", "  \n"])).toEqual([
      "evidence",
      "(empty content)",
      "(empty content)"
    ]);
  });
});
