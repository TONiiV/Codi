import { EnvironmentId, ProjectId, type UsageProviderKind } from "@t3tools/contracts";
import type { ProjectProviderTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageFlow, OUTSIDE_CODI_LABEL, type FlowUnit } from "./usageFlow";

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
});
