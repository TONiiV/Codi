import { EnvironmentId, ProjectId, type UsageProviderKind } from "@t3tools/contracts";
import type { ProjectProviderTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageFlow, fitLabel, OUTSIDE_CODI_LABEL, type FlowUnit } from "./UsageFlow.logic";

const environmentId = EnvironmentId.make("env-1");

const entry = (
  projectId: string | null,
  provider: UsageProviderKind,
  scale: number,
  unsplit = 0,
): ProjectProviderTotals => {
  const categoryCost = { input: scale, cacheRead: scale / 10, cacheWrite: scale / 4, output: 5 };
  return {
    environmentId,
    projectId: projectId === null ? null : ProjectId.make(projectId),
    provider,
    costUsd: categoryCost.input + categoryCost.cacheRead + categoryCost.cacheWrite + 5 + unsplit,
    totalTokens: scale * 1_000 + 300,
    tokens: {
      uncachedInputTokens: scale * 100,
      cachedInputTokens: scale * 800,
      cacheCreationTokens: scale * 100,
      outputTokens: 300,
      reasoningTokens: 120,
    },
    categoryCost: { ...categoryCost, unsplit },
  };
};

const sum = (entries: readonly { readonly value: number }[]) =>
  entries.reduce((total, current) => total + current.value, 0);

const inputTotal = (entries: readonly ProjectProviderTotals[], unit: FlowUnit) =>
  entries.reduce((total, e) => total + (unit === "tokens" ? e.totalTokens : e.costUsd), 0);

describe("buildUsageFlow", () => {
  it.each<FlowUnit>(["tokens", "cost"])("keeps every column total equal in %s mode", (unit) => {
    const flow = buildUsageFlow(
      [
        entry("p1", "claude", 40),
        entry("p1", "codex", 12, 3),
        entry("p2", "codex", 7),
        entry(null, "claude", 9, 2),
        entry(null, "cursor", 4),
      ],
      unit,
      (_environment, projectId) => `project ${projectId}`,
    );

    expect(sum(flow.projects)).toBeCloseTo(flow.total, 9);
    expect(sum(flow.providers)).toBeCloseTo(flow.total, 9);
    expect(sum(flow.types)).toBeCloseTo(flow.total, 9);
    expect(sum(flow.cells)).toBeCloseTo(flow.total, 9);

    const outside = flow.projects.find((project) => project.label === OUTSIDE_CODI_LABEL);
    const expectedOutside =
      unit === "tokens"
        ? entry(null, "claude", 9).totalTokens + entry(null, "cursor", 4).totalTokens
        : entry(null, "claude", 9, 2).costUsd + entry(null, "cursor", 4).costUsd;
    expect(outside?.value).toBeCloseTo(expectedOutside, 9);
    expect(flow.projects.map((project) => project.label)).toEqual([
      "project p1",
      "project p2",
      OUTSIDE_CODI_LABEL,
    ]);
    expect(flow.types.some((type) => type.key === "other")).toBe(unit === "cost");
  });

  it.each<[FlowUnit, number]>([
    ["tokens", 8],
    ["tokens", 10],
    ["cost", 8],
    ["cost", 10],
  ])("in %s mode with %i projects, folds past the seventh without losing usage", (unit, count) => {
    // A sub-cent unsplit on every entry adds up past a cent, as the Cost tab sums it.
    const input = Array.from({ length: count }, (_, index) =>
      entry(`p${index}`, index % 2 === 0 ? "claude" : "codex", 10 + index, 0.004),
    );
    const flow = buildUsageFlow(input, unit, (_environment, projectId) => `project ${projectId}`);

    expect(flow.total).toBeCloseTo(inputTotal(input, unit), 9);
    expect(sum(flow.cells)).toBeCloseTo(flow.total, 9);
    const others = flow.projects.find((project) => project.label === "其他项目");
    if (count > 8) {
      expect(flow.projects).toHaveLength(8);
      expect(others?.value).toBeCloseTo(inputTotal(input.slice(0, count - 7), unit), 9);
    } else {
      expect(flow.projects).toHaveLength(count);
      expect(others).toBeUndefined();
    }
    const other = flow.types.find((type) => type.key === "other");
    expect(other?.value ?? 0).toBeCloseTo(unit === "cost" ? 0.004 * count : 0, 9);
  });

  it("drops a summed unsplit cost under a cent, like the Cost tab", () => {
    const flow = buildUsageFlow([entry("p1", "claude", 10, 0.004)], "cost", () => "p1");
    expect(flow.types.some((type) => type.key === "other")).toBe(false);
  });
});

describe("fitLabel", () => {
  // Labels end-anchor 160 units from the left edge. Widths per glyph are measured at text-sm:
  // CJK is one em (14); "acme-payments-service…" rendered 177 units wide, about 8.05 per glyph.
  it.each([
    ["用于测试标签截断效果的一个很长的中文项目名", 14],
    ["acme-payments-service-api", 8.05],
  ])("keeps %s inside the viewBox", (name, glyph) => {
    const label = fitLabel(name, 152);
    expect(label.endsWith("…")).toBe(true);
    expect(160 - glyph * [...label].length).toBeGreaterThanOrEqual(0);
  });

  it("leaves a label that fits untouched", () => {
    expect(fitLabel("web 前端", 152)).toBe("web 前端");
  });
});
