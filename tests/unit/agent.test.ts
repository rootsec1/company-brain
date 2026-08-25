import { describe, expect, it } from "vitest";
import { openRouterStepCost, searchChunksWithFallback, shouldForceSynthesis, toJsonSafe } from "@/lib/agent/research-agent";

describe("agent resource accounting", () => {
  it("reads official OpenRouter usage accounting without trusting malformed metadata", () => {
    expect(openRouterStepCost({ providerMetadata: { openrouter: { usage: { cost: 0.0125 } } } })).toBe(0.0125);
    expect(openRouterStepCost({ providerMetadata: { openrouter: { usage: { cost: "0.0125" } } } })).toBe(0);
    expect(openRouterStepCost({})).toBe(0);
  });

  it("recovers when the model guesses a nonexistent kind taxonomy", async () => {
    const expected = [{ id: "chunk-1" }] as never[];
    const calls: unknown[] = [];
    const search = async (request: unknown) => {
      calls.push(request);
      return calls.length === 1 ? [] : expected;
    };
    await expect(searchChunksWithFallback({ query: "Nebula", kinds: ["document", "message"], limit: 10 }, search as never)).resolves.toBe(expected);
    expect(calls).toEqual([
      expect.objectContaining({ kinds: ["document", "message"], mode: "agent" }),
      { query: "Nebula", limit: 10, mode: "agent" }
    ]);
  });

  it("reserves the final step for a tool-free answer", () => {
    const lowCost = { usage: { inputTokens: 10 }, providerMetadata: { openrouter: { usage: { cost: 0.01 } } } };
    expect(shouldForceSynthesis([lowCost], 1)).toBe(false);
    expect(shouldForceSynthesis([lowCost], 5)).toBe(true);
    expect(shouldForceSynthesis([{ ...lowCost, providerMetadata: { openrouter: { usage: { cost: 0.09 } } } }], 2)).toBe(true);
  });

  it("normalizes database values before tool results are replayed", () => {
    const result = toJsonSafe({ createdAt: new Date("2026-08-25T00:00:00.000Z"), optional: undefined });
    expect(result).toEqual({ createdAt: "2026-08-25T00:00:00.000Z" });
  });
});
