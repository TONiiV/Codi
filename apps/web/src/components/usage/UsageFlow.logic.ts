import type { EnvironmentId, ProjectId, UsageProviderKind } from "@t3tools/contracts";
import type { ProjectProviderTotals } from "@t3tools/shared/usageMerge";

import { PROVIDER_PRESENTATION } from "./usageProviders";

export type FlowUnit = "tokens" | "cost";
export type FlowTypeKey = "input" | "cacheRead" | "cacheWrite" | "output" | "other";

const OUTSIDE_CODI_KEY = "outside";
export const OUTSIDE_CODI_LABEL = "Codi 之外";
const OTHER_PROJECTS_KEY = "others";
const MAX_PROJECTS = 8;

const FLOW_TYPE_LABEL: Record<FlowTypeKey, string> = {
  input: "输入",
  cacheRead: "缓存读",
  cacheWrite: "缓存写",
  output: "输出",
  other: "其他",
};
const TYPE_ORDER = Object.keys(FLOW_TYPE_LABEL) as FlowTypeKey[];

export interface FlowCell {
  readonly project: string;
  readonly provider: UsageProviderKind;
  readonly type: FlowTypeKey;
  readonly value: number;
}

export interface FlowEntry<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly value: number;
}

export interface UsageFlowData {
  readonly total: number;
  readonly projects: readonly FlowEntry<string>[];
  readonly providers: readonly FlowEntry<UsageProviderKind>[];
  readonly types: readonly FlowEntry<FlowTypeKey>[];
  /** Ordered provider, type, project so bands stay contiguous where they leave and enter nodes. */
  readonly cells: readonly FlowCell[];
}

function cellValues(entry: ProjectProviderTotals, unit: FlowUnit): Record<FlowTypeKey, number> {
  if (unit === "tokens") {
    return {
      input: entry.tokens.uncachedInputTokens,
      cacheRead: entry.tokens.cachedInputTokens,
      cacheWrite: entry.tokens.cacheCreationTokens,
      output: entry.tokens.outputTokens,
      other: 0,
    };
  }
  const { input, cacheRead, cacheWrite, output, unsplit } = entry.categoryCost;
  return { input, cacheRead, cacheWrite, output, other: unsplit };
}

// CJK glyphs are one em wide; the average Latin glyph at the label weight is about 0.58 em.
const LABEL_EM = 14;
const glyphWidth = (char: string) =>
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(
    char,
  )
    ? LABEL_EM
    : LABEL_EM * 0.58;
const labelWidth = (text: string) => [...text].reduce((width, char) => width + glyphWidth(char), 0);

export function fitLabel(text: string, maxWidth: number): string {
  if (labelWidth(text) <= maxWidth) return text;
  let fitted = "";
  let width = glyphWidth("…");
  for (const char of text) {
    width += glyphWidth(char);
    if (width > maxWidth) break;
    fitted += char;
  }
  return `${fitted}…`;
}

function sumBy<Key>(cells: readonly FlowCell[], key: (cell: FlowCell) => Key): Map<Key, number> {
  const totals = new Map<Key, number>();
  for (const cell of cells) totals.set(key(cell), (totals.get(key(cell)) ?? 0) + cell.value);
  return totals;
}

const byValue = <Entry extends { readonly value: number }>(a: Entry, b: Entry) => b.value - a.value;

/** Every column derives from the same cells, so the four column totals always agree. */
export function buildUsageFlow(
  projectProviders: readonly ProjectProviderTotals[],
  unit: FlowUnit,
  projectLabel: (environmentId: EnvironmentId, projectId: ProjectId) => string,
): UsageFlowData {
  const labels = new Map<string, string>([[OUTSIDE_CODI_KEY, OUTSIDE_CODI_LABEL]]);
  const all: FlowCell[] = [];
  for (const entry of projectProviders) {
    const project =
      entry.projectId === null
        ? OUTSIDE_CODI_KEY
        : JSON.stringify([entry.environmentId, entry.projectId]);
    if (entry.projectId !== null && !labels.has(project)) {
      labels.set(project, projectLabel(entry.environmentId, entry.projectId));
    }
    const values = cellValues(entry, unit);
    for (const type of TYPE_ORDER) {
      if (values[type] > 0) {
        all.push({ project, provider: entry.provider, type, value: values[type] });
      }
    }
  }

  // Same cutoff as the Cost tab, on the summed "other": below a cent it is rounding.
  const unsplit = all.reduce((sum, cell) => sum + (cell.type === "other" ? cell.value : 0), 0);
  const raw = unsplit >= 0.005 ? all : all.filter((cell) => cell.type !== "other");

  const ranked = [...sumBy(raw, (cell) => cell.project)]
    .filter(([key]) => key !== OUTSIDE_CODI_KEY)
    .map(([key, value]) => ({ key, value }))
    .sort(byValue);
  const kept = new Set(
    ranked
      .slice(0, ranked.length > MAX_PROJECTS ? MAX_PROJECTS - 1 : MAX_PROJECTS)
      .map((entry) => entry.key),
  );
  kept.add(OUTSIDE_CODI_KEY);
  labels.set(OTHER_PROJECTS_KEY, "其他项目");
  const merged = new Map<string, FlowCell>();
  for (const cell of raw) {
    const project = kept.has(cell.project) ? cell.project : OTHER_PROJECTS_KEY;
    const key = JSON.stringify([project, cell.provider, cell.type]);
    const value = (merged.get(key)?.value ?? 0) + cell.value;
    merged.set(key, { ...cell, project, value });
  }
  const cells = [...merged.values()];

  const projectOrder = [...kept, OTHER_PROJECTS_KEY];
  const projects = [...sumBy(cells, (cell) => cell.project)]
    .map(([key, value]) => ({ key, label: labels.get(key) ?? key, value }))
    .sort((a, b) => projectOrder.indexOf(a.key) - projectOrder.indexOf(b.key));
  const providers = [...sumBy(cells, (cell) => cell.provider)]
    .map(([key, value]) => ({ key, label: PROVIDER_PRESENTATION[key].label, value }))
    .sort(byValue);
  const types = [...sumBy(cells, (cell) => cell.type)]
    .map(([key, value]) => ({ key, label: FLOW_TYPE_LABEL[key], value }))
    .sort((a, b) => TYPE_ORDER.indexOf(a.key) - TYPE_ORDER.indexOf(b.key));

  const rank = (list: readonly FlowEntry<string>[], key: string) =>
    list.findIndex((entry) => entry.key === key);
  cells.sort(
    (a, b) =>
      rank(providers, a.provider) - rank(providers, b.provider) ||
      rank(types, a.type) - rank(types, b.type) ||
      rank(projects, a.project) - rank(projects, b.project),
  );

  return {
    total: projects.reduce((sum, project) => sum + project.value, 0),
    projects,
    providers,
    types,
    cells,
  };
}
