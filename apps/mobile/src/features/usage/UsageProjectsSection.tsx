import {
  USAGE_CONTRACT_VERSION,
  USAGE_PROJECTS_SINCE,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { isCompatibleUsageContractVersion, type MergedUsage } from "@t3tools/shared/usageMerge";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { useProjects } from "../../state/entities";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { SettingsSection } from "../settings/components/SettingsSection";
import type { UsageChartMetric } from "./usageChartData";
import { PROVIDER_LABEL, PROVIDER_ORDER } from "./usageProviders";

const OUTSIDE_CODI = "Codi 之外";

export function UsageProjectsSection(props: {
  readonly merged: MergedUsage;
  readonly metric: UsageChartMetric;
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const projects = useProjects();
  const showEnvironment = props.merged.contributingEnvironments.length > 1;
  const outdated = props.environments.filter(
    (environment) =>
      environment.summary !== null &&
      environment.summary.contractVersion < USAGE_PROJECTS_SINCE &&
      isCompatibleUsageContractVersion(environment.summary.contractVersion, USAGE_CONTRACT_VERSION),
  );
  const value = (entry: { costUsd: number; totalTokens: number }) =>
    props.metric === "cost" ? entry.costUsd : entry.totalTokens;
  const format = props.metric === "cost" ? formatUsd : formatTokens;
  const rows = new Map<
    string,
    { key: string; label: string; cells: Map<UsageProviderKind, number> }
  >();
  for (const entry of props.merged.projectProviders) {
    const key = entry.projectId === null ? "" : `${entry.environmentId}:${entry.projectId}`;
    const title =
      projects.find((p) => p.environmentId === entry.environmentId && p.id === entry.projectId)
        ?.title ?? "未知项目";
    const environment = props.environments.find((e) => e.environmentId === entry.environmentId);
    const label =
      entry.projectId === null
        ? OUTSIDE_CODI
        : showEnvironment && environment
          ? `${title} · ${environment.label}`
          : title;
    const row = rows.get(key) ?? { key, label, cells: new Map() };
    row.cells.set(entry.provider, (row.cells.get(entry.provider) ?? 0) + value(entry));
    rows.set(key, row);
  }
  const providers = PROVIDER_ORDER.filter((provider) =>
    [...rows.values()].some((row) => (row.cells.get(provider) ?? 0) > 0),
  );
  const total = (row: { cells: Map<UsageProviderKind, number> }) =>
    [...row.cells.values()].reduce((sum, cell) => sum + cell, 0);
  // Hermes lacks toSorted.
  const ordered = [...rows.values()]
    .filter((row) => total(row) > 0)
    .sort(
      (a, b) =>
        Number(a.label === OUTSIDE_CODI) - Number(b.label === OUTSIDE_CODI) || total(b) - total(a),
    );
  if (ordered.length === 0) return null;

  const cell = "w-24 px-3 py-2.5 text-right text-sm tabular-nums";
  return (
    <SettingsSection
      title="项目 × provider"
      footer={outdated
        .map(
          (environment) =>
            `${environment.label} 的服务端需要更新才能按项目统计，它的用量计入「Codi 之外」。`,
        )
        .join("\n")}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {[
            { key: "header", label: "项目", header: true },
            ...ordered.map((row) => ({ ...row, header: false })),
          ].map((row, index) => (
            <View
              key={row.key}
              className={cn("flex-row", index > 0 && "border-t border-border-subtle")}
            >
              <Text className="w-40 px-4 py-2.5 text-sm text-foreground" numberOfLines={1}>
                {row.label}
              </Text>
              {[...providers, "total" as const].map((provider) => (
                <Text
                  key={provider}
                  className={cn(cell, row.header ? "text-foreground-muted" : "text-foreground")}
                  numberOfLines={1}
                >
                  {"cells" in row
                    ? format(provider === "total" ? total(row) : (row.cells.get(provider) ?? 0))
                    : provider === "total"
                      ? "合计"
                      : PROVIDER_LABEL[provider]}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SettingsSection>
  );
}
