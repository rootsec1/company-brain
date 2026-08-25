import { describe, expect, it } from "vitest";
import { assertSafeSchedule, fallbackWorkflowDraft, formatWorkflowArtifact, inferSchedule, inferWorkflowOutput } from "@/lib/services/workflows";

describe("natural-language workflow scheduling", () => {
  it.each([
    ["Every weekday at 9am summarize launches", "0 9 * * 1-5"],
    ["Every Monday at 8:30am brief me", "30 8 * * 1"],
    ["Daily at 5pm find stale policies", "0 17 * * *"],
    ["Every 2 hours check incidents", "0 */2 * * *"],
    ["Every 5 minutes check incidents", "*/15 * * * *"]
  ])("maps %s", (instruction, expected) => expect(inferSchedule(instruction)).toBe(expected));

  it("keeps the research objective and makes no workflow active implicitly", () => {
    const draft = fallbackWorkflowDraft("Every weekday at 9am summarize launch risks");
    expect(draft.prompt).toContain("summarize launch risks");
    expect(draft.schedule).toBe("0 9 * * 1-5");
  });

  it("infers generated artifact formats without changing ordinary answers", () => {
    expect(inferWorkflowOutput("Generate a weekly Markdown brief")).toBe("markdown");
    expect(inferWorkflowOutput("Export structured JSON for the launch risks")).toBe("json");
    expect(inferWorkflowOutput("Summarize launch risks")).toBe("answer");
    expect(() => JSON.parse(formatWorkflowArtifact({ workflowName: "Risk brief", output: "json", answer: "Grounded answer", sources: [] }))).not.toThrow();
  });

  it("rejects unsafe or excessively frequent schedules", () => {
    expect(() => assertSafeSchedule("* * * * *")).toThrow("at least");
    expect(() => assertSafeSchedule("*/5 * * * *")).toThrow("at least");
    expect(() => assertSafeSchedule("0,5 * * * *")).toThrow("at least");
    expect(() => assertSafeSchedule("99 99 * * *")).toThrow("valid");
    expect(() => assertSafeSchedule("delete everything")).toThrow("five-field");
    expect(() => assertSafeSchedule("*/15 * * * *")).not.toThrow();
  });
});
