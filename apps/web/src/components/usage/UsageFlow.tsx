import { USAGE_CONTRACT_VERSION, USAGE_PROJECTS_SINCE } from "@t3tools/contracts";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { isCompatibleUsageContractVersion, type MergedUsage } from "@t3tools/shared/usageMerge";
import { useState } from "react";

import { useProjects } from "../../state/entities";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { TYPE_COLORS } from "./usageBreakdown";
import { buildUsageFlow, fitLabel, type FlowUnit, type UsageFlowData } from "./usageFlow";
import { PROVIDER_PRESENTATION } from "./usageProviders";

const W = 960;
const NODE = 14;
const GAP = 12;
const LINE = 14;
const COLS = [170, 400, 630, 840] as const;
const PROJECT_COLOR = "var(--primary)";
const HALO = { paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 4 } as const;

interface Node {
  readonly key: string;
  readonly col: 0 | 1 | 2 | 3;
  readonly value: number;
  readonly color: string;
  readonly title: string;
  readonly fullTitle: string;
  readonly detail: string;
  readonly project: string | null;
  y: number;
}

function band(x0: number, y0: number, x1: number, y1: number, h: number) {
  const mx = (x0 + x1) / 2;
  return `M${x0} ${y0} C${mx} ${y0} ${mx} ${y1} ${x1} ${y1} L${x1} ${y1 + h} C${mx} ${y1 + h} ${mx} ${y0 + h} ${x0} ${y0 + h} Z`;
}

// Project labels end-anchor at COLS[0] - 10; keep a small margin from the viewBox edge.
const PROJECT_LABEL_WIDTH = COLS[0] - 18;

function FlowSankey({ flow, unit }: { readonly flow: UsageFlowData; readonly unit: FlowUnit }) {
  const [focus, setFocus] = useState<string | null>(null);
  const fmt = unit === "tokens" ? formatTokens : formatUsd;
  const share = (value: number) => `${fmt(value)} · ${formatPercent(value / flow.total, 0)}`;
  const tallest = Math.max(flow.projects.length, flow.providers.length, flow.types.length);
  const baseHeight = Math.max(320, tallest * (LINE * 3 + 4) + 40);
  const scale = (baseHeight - 40 - GAP * (tallest - 1)) / flow.total;

  const totalTitle = unit === "tokens" ? "总用量" : "总费用";
  const nodes: Node[] = [
    ...flow.projects.map((project) => ({
      key: `p:${project.key}`,
      col: 0 as const,
      value: project.value,
      color: PROJECT_COLOR,
      title: fitLabel(project.label, PROJECT_LABEL_WIDTH),
      fullTitle: project.label,
      detail: share(project.value),
      project: project.key,
      y: 0,
    })),
    {
      key: "total",
      col: 1,
      value: flow.total,
      color: PROJECT_COLOR,
      title: totalTitle,
      fullTitle: totalTitle,
      detail: fmt(flow.total),
      project: null,
      y: 0,
    },
    ...flow.providers.map((provider) => ({
      key: `h:${provider.key}`,
      col: 2 as const,
      value: provider.value,
      color: PROVIDER_PRESENTATION[provider.key].color,
      title: provider.label,
      fullTitle: provider.label,
      detail: share(provider.value),
      project: null,
      y: 0,
    })),
    ...flow.types.map((type) => ({
      key: `t:${type.key}`,
      col: 3 as const,
      value: type.value,
      color: TYPE_COLORS[type.key],
      title: type.label,
      fullTitle: type.label,
      detail: share(type.value),
      project: null,
      y: 0,
    })),
  ];
  for (const col of [0, 1, 2, 3]) {
    const column = nodes.filter((node) => node.col === col);
    const height =
      column.reduce((sum, node) => sum + node.value * scale, 0) + GAP * (column.length - 1);
    let y = (baseHeight - height) / 2 + 12;
    for (const node of column) {
      node.y = y;
      y += node.value * scale + GAP;
    }
  }
  const at = new Map(nodes.map((node) => [node.key, node]));

  const links = [
    ...flow.projects.map((project) => ({
      from: `p:${project.key}`,
      to: "total",
      value: project.value,
      color: PROJECT_COLOR,
      project: project.key,
    })),
    ...flow.providers.flatMap((provider) =>
      flow.projects.map((project) => ({
        from: "total",
        to: `h:${provider.key}`,
        value: flow.cells
          .filter((cell) => cell.provider === provider.key && cell.project === project.key)
          .reduce((sum, cell) => sum + cell.value, 0),
        color: PROVIDER_PRESENTATION[provider.key].color,
        project: project.key,
      })),
    ),
    ...flow.cells.map((cell) => ({
      from: `h:${cell.provider}`,
      to: `t:${cell.type}`,
      value: cell.value,
      color: TYPE_COLORS[cell.type],
      project: cell.project,
    })),
  ].filter((link) => link.value > 0);
  // Bands leave and enter a node in list order, so offsets accumulate per node.
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const paths = links.flatMap((link, index) => {
    const from = at.get(link.from);
    const to = at.get(link.to);
    if (!from || !to) return [];
    const y0 = from.y + (outOffset.get(link.from) ?? 0);
    const y1 = to.y + (inOffset.get(link.to) ?? 0);
    const h = link.value * scale;
    outOffset.set(link.from, y0 - from.y + h);
    inOffset.set(link.to, y1 - to.y + h);
    return [{ ...link, id: index, d: band(COLS[from.col] + NODE, y0, COLS[to.col], y1, h) }];
  });

  // Labels centre on their node and are pushed down when the node above is too short.
  const labelY = new Map<string, number>();
  let bottom = baseHeight;
  for (const col of [0, 2, 3]) {
    let previous = 0;
    for (const node of nodes.filter((candidate) => candidate.col === col)) {
      const block = LINE * 2;
      const y = Math.max(node.y + (node.value * scale) / 2 - block / 2, previous + 4);
      labelY.set(node.key, y);
      previous = y + block;
      bottom = Math.max(bottom, previous + 8);
    }
  }
  const dimmed = (project: string | null) =>
    focus !== null && project !== null && project !== focus;

  return (
    <svg
      viewBox={`0 0 ${W} ${bottom}`}
      role="img"
      aria-label="用量流向：项目流向总量，再流向各 provider，再分成输入、缓存读、缓存写和输出"
      className="w-full"
      onMouseLeave={() => setFocus(null)}
    >
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          fill={path.color}
          opacity={dimmed(path.project) ? 0.06 : 0.36}
          onMouseEnter={() => setFocus(path.project)}
        />
      ))}
      {nodes.map((node) => {
        const x = COLS[node.col];
        const h = Math.max(2, node.value * scale);
        const anchor = node.col === 0 ? "end" : node.col === 1 ? "middle" : "start";
        const tx = node.col === 0 ? x - 10 : node.col === 1 ? x + NODE / 2 : x + NODE + 10;
        const ty = node.col === 1 ? node.y - 8 - LINE : (labelY.get(node.key) ?? node.y) + 12;
        return (
          <g
            key={node.key}
            opacity={dimmed(node.project) ? 0.35 : 1}
            onMouseEnter={node.project === null ? undefined : () => setFocus(node.project)}
          >
            {node.title === node.fullTitle ? null : <title>{node.fullTitle}</title>}
            {node.project === null ? null : (
              <rect
                x={0}
                y={Math.min(node.y, ty - 12)}
                width={x + NODE}
                height={Math.max(h, LINE * 2)}
                fill="transparent"
              />
            )}
            <rect x={x} y={node.y} width={NODE} height={h} fill={node.color} rx={1} />
            <text
              x={tx}
              y={ty}
              textAnchor={anchor}
              className="fill-foreground text-sm font-medium"
              style={HALO}
            >
              {node.title}
            </text>
            <text
              x={tx}
              y={ty + LINE}
              textAnchor={anchor}
              className="fill-muted-foreground text-2xs tabular-nums"
              style={HALO}
            >
              {node.detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function UsageFlow({
  merged,
  environments,
}: {
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const [unit, setUnit] = useState<FlowUnit>("tokens");
  const projects = useProjects();
  const showEnvironment = merged.contributingEnvironments.length > 1;
  const flow = buildUsageFlow(merged.projectProviders, unit, (environmentId, projectId) => {
    const title =
      projects.find(
        (project) => project.environmentId === environmentId && project.id === projectId,
      )?.title ?? "未知项目";
    const environment = environments.find((entry) => entry.environmentId === environmentId);
    return showEnvironment && environment ? `${title} · ${environment.label}` : title;
  });
  const outdated = environments.filter(
    (environment) =>
      environment.summary !== null &&
      environment.summary.contractVersion < USAGE_PROJECTS_SINCE &&
      isCompatibleUsageContractVersion(environment.summary.contractVersion, USAGE_CONTRACT_VERSION),
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {unit === "tokens" ? "按 token 计" : "按 API 估算费用计，与 Cost 页口径一致"}
        </span>
        <ToggleGroup
          aria-label="Flow unit"
          variant="segmented"
          value={[unit]}
          onValueChange={(next) => {
            if (next[0] === "tokens" || next[0] === "cost") setUnit(next[0]);
          }}
        >
          <Toggle value="tokens">Token</Toggle>
          <Toggle value="cost">费用</Toggle>
        </ToggleGroup>
      </div>
      {outdated.map((environment) => (
        <p key={environment.environmentId} className="text-sm text-muted-foreground">
          {environment.label} 的服务端需要更新才能按项目统计，它的用量计入「Codi 之外」。
        </p>
      ))}
      {flow.total > 0 ? (
        <FlowSankey flow={flow} unit={unit} />
      ) : (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>这段时间没有用量</EmptyTitle>
            <EmptyDescription>
              换一个时间段，或等 provider 的会话记录写入后再刷新。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}
