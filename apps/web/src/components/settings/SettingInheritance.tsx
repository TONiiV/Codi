import {
  DEFAULT_SERVER_SETTINGS,
  PROJECT_FILE_BACKED_SETTINGS,
  type ProjectFileBackedSettingKey,
  resolveEnvironmentMachineKind,
  type ServerSettings,
} from "@t3tools/contracts";
import { CheckIcon, ChevronRightIcon, LayersIcon } from "lucide-react";
import * as Equal from "effect/Equal";

import { cn } from "../../lib/utils";
import type { EnvironmentPresentation } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { envModeText, mergeMethodText, worktreeSubmodulesText } from "./SettingsPanels.enumLabels";
import { Button, InlineButton } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import type { ProjectOverrideEntry, ScopedSettingsTarget } from "./scopedSettings";
import { isProjectScopedSettingKey } from "./scopedSettings";
import { settingsScopeEnvironmentLabels } from "./settingsScopeAxis";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { englishT } from "~/i18n/englishT";

interface InheritanceLayer {
  readonly key: "project" | "environment" | "t3.json" | "built-in";
  readonly label: string;
  readonly value: string;
  readonly effective: boolean;
  readonly set: boolean;
}

const WRITING_STYLE_LABELS: Record<string, string> = {
  repo_conventions: "settings.manual.scwMode.repoConventions.label",
  conventional_commits: "settings.manual.scwMode.conventionalCommits.label",
  custom: "settings.manual.scwMode.custom.label",
};

const BACKGROUND_ACTIVITY_PROFILE_LABELS: Record<string, { key: string; fallback: string }> = {
  balanced: { key: "settings.parallelA.bgBalanced", fallback: "Balanced" },
  performance: { key: "settings.parallelA.bgPerformance", fallback: "Performance" },
  "battery-saver": { key: "settings.parallelA.bgBatterySaver", fallback: "Battery saver" },
  custom: { key: "settings.text.advanced", fallback: "Advanced" },
};

function formatValue(key: keyof ServerSettings, value: unknown, t: TFunction = englishT): string {
  if (value === null || value === undefined) {
    return key === "pullRequestMergeMethod"
      ? t("settings.text.lastSelected")
      : key === "sidebarAutoSettleAfterDays"
        ? t("settings.text.never")
        : key === "defaultModelSelection"
          ? t("settings.text.automatic")
          : key === "sourceControlWriterModelSelection"
            ? t("settings.text.textGenerationModel2")
            : key === "reviewGuideModelSelection"
              ? t("settings.text.sourceControlWriterModel")
              : key === "defaultThreadEnvMode" || key === "worktreeSubmodules"
                ? t("settings.text.inherit")
                : t("settings.text.notSet");
  }
  if (typeof value === "boolean") return value ? t("settings.text.on") : t("settings.text.off");
  if (typeof value === "number") {
    return key === "sidebarAutoSettleAfterDays"
      ? t(value === 1 ? "settings.parallelA.inheritDay1" : "settings.parallelA.inheritDayN", {
          count: value,
          defaultValue: `${value} ${value === 1 ? "day" : "days"}`,
        })
      : String(value);
  }
  if (typeof value === "string") {
    if (key === "defaultThreadEnvMode" && (value === "local" || value === "worktree")) {
      return envModeText(value, t);
    }
    if (
      key === "worktreeSubmodules" &&
      (value === "recursive" || value === "top-level" || value === "none")
    ) {
      return worktreeSubmodulesText(value, t);
    }
    if (
      key === "pullRequestMergeMethod" &&
      (value === "merge" || value === "squash" || value === "rebase")
    ) {
      return mergeMethodText(value, t);
    }
    return value === "" ? t("settings.text.empty") : value;
  }
  if (Array.isArray(value))
    return t(
      value.length === 1 ? "settings.parallelA.inheritItem1" : "settings.parallelA.inheritItemN",
      {
        count: value.length,
        defaultValue: `${value.length} ${value.length === 1 ? "item" : "items"}`,
      },
    );
  if (typeof value === "object") {
    if (key === "backgroundActivity" && "profile" in value && typeof value.profile === "string") {
      const profile = BACKGROUND_ACTIVITY_PROFILE_LABELS[value.profile];
      return profile ? t(profile.key, { defaultValue: profile.fallback }) : value.profile;
    }
    if ("model" in value && typeof value.model === "string") return value.model;
    if ("mode" in value && typeof value.mode === "string") {
      if (key === "worktreeCleanup")
        return value.mode === "off" ? t("settings.text.off") : t("settings.text.custom3");
      return key === "sourceControlWritingStyle"
        ? WRITING_STYLE_LABELS[value.mode]
          ? t(WRITING_STYLE_LABELS[value.mode]!)
          : value.mode
        : value.mode;
    }
  }
  return t("settings.text.custom3");
}

/** Matches resolveProjectSettings order. */
export function settingInheritanceLayers(
  target: ScopedSettingsTarget,
  environmentSettings: ServerSettings,
  key: keyof ServerSettings,
  t: TFunction = englishT,
): readonly InheritanceLayer[] {
  const environmentValue = environmentSettings[key];
  const source = isProjectScopedSettingKey(key) ? target.sources[key] : "environment";
  const environmentSet = !Equal.equals(environmentValue, DEFAULT_SERVER_SETTINGS[key]);
  const fileBacked = isProjectFileBackedSettingKey(key);
  const layers: InheritanceLayer[] = [];
  if (target.projectId !== null && isProjectScopedSettingKey(key)) {
    layers.push({
      key: "project",
      label: t("settings.text.project"),
      value:
        source === "project"
          ? formatValue(key, target.settings[key], t)
          : t("settings.text.inherits"),
      effective: source === "project",
      set: source === "project",
    });
  }
  layers.push({
    key: "environment",
    label: target.label,
    value: environmentSet ? formatValue(key, environmentValue, t) : t("settings.text.inherits"),
    effective: source === "environment" && environmentSet,
    set: environmentSet,
  });
  if (fileBacked && target.projectId !== null) {
    layers.push({
      key: "t3.json",
      label: "t3.json",
      value:
        source === "t3.json"
          ? formatValue(key, target.settings[key], t)
          : t("settings.text.inherits"),
      effective: source === "t3.json",
      set: source === "t3.json",
    });
  }
  // File-backed defaults come from the resolver, not the schema's decoded null.
  const builtIn = fileBacked
    ? PROJECT_FILE_BACKED_SETTINGS[key].builtIn
    : DEFAULT_SERVER_SETTINGS[key];
  layers.push({
    key: "built-in",
    label: t("settings.text.default"),
    value: formatValue(key, builtIn, t),
    effective: source === "environment" && !environmentSet,
    set: true,
  });
  return layers;
}

function isProjectFileBackedSettingKey(
  key: keyof ServerSettings,
): key is ProjectFileBackedSettingKey {
  return Object.hasOwn(PROJECT_FILE_BACKED_SETTINGS, key);
}

export type SettingInheritanceState =
  | "default"
  | "environment"
  | "inherited"
  | "overridden"
  | "mixed";

export interface SettingOverridingProject extends ProjectOverrideEntry {
  readonly label: string;
  readonly open: () => void;
}

export function SettingInheritance({
  state,
  summary,
  targets,
  environments,
  keys,
  overridingProjects = [],
  onClearOverrides,
}: {
  state: SettingInheritanceState;
  summary: string;
  targets: readonly ScopedSettingsTarget[];
  environments: readonly Pick<
    EnvironmentPresentation,
    "environmentId" | "label" | "displayUrl" | "serverConfig"
  >[];
  keys: readonly (keyof ServerSettings)[];
  overridingProjects?: readonly SettingOverridingProject[];
  onClearOverrides?: (entries: readonly ProjectOverrideEntry[]) => void;
}) {
  const { t } = useTranslation();
  const scopeContext = useOptionalSettingsScope();
  const key = keys[0];
  if (!key || targets.length === 0) return null;
  const hasMultipleEnvironments = new Set(targets.map((target) => target.environmentId)).size > 1;
  const overrideSummary =
    overridingProjects.length > 0
      ? t(
          overridingProjects.length === 1
            ? "settings.parallelA.inheritProjectOverride1"
            : "settings.parallelA.inheritProjectOverrideN",
          {
            summary,
            count: overridingProjects.length,
          },
        )
      : summary;
  const chains = targets.flatMap((target) => {
    const environment = environments.find(
      (candidate) => candidate.environmentId === target.environmentId,
    );
    if (!environment?.serverConfig) return [];
    const labels = settingsScopeEnvironmentLabels(environment, environments);
    const path = scopeContext?.scope.members.find(
      (member) => member.environmentId === target.environmentId && member.id === target.projectId,
    )?.workspaceRoot;
    const secondary = [labels.secondary, path?.split(/[\\/]/).filter(Boolean).slice(-2).join("/")]
      .filter(Boolean)
      .join(" · ");
    const layers = settingInheritanceLayers(target, environment.serverConfig.settings, key, t);
    const winningLayer = layers.find((layer) => layer.effective);
    return [
      {
        id: `${target.environmentId}:${target.projectId ?? ""}`,
        target,
        label: [labels.primary, secondary].filter(Boolean).join(" · "),
        machineLabel: [labels.primary, labels.secondary].filter(Boolean).join(" · "),
        overrides: environment.serverConfig.settings.projectSettingsOverrides,
        machine: resolveEnvironmentMachineKind(environment.serverConfig),
        layers,
        winningLayer,
        resolution: {
          winner: winningLayer?.key,
          layers: layers.map(({ key, value }) => [key, value]),
          settings: keys.map((settingKey) => target.settings[settingKey]),
        },
      },
    ];
  });
  const primary =
    chains.find(
      ({ target }) =>
        target.environmentId === scopeContext?.target?.environmentId &&
        target.projectId === scopeContext?.target?.projectId,
    ) ?? chains[0];
  const machineLabelFor = (environmentId: string) =>
    chains.find((entry) => entry.target.environmentId === environmentId)?.machineLabel ?? "";
  const groups: (typeof chains)[] = [];
  for (const chain of hasMultipleEnvironments && primary
    ? [primary, ...chains.filter((entry) => entry !== primary)]
    : chains) {
    const group =
      hasMultipleEnvironments &&
      groups.find(([first]) => first && Equal.equals(first.resolution, chain.resolution));
    if (group) group.push(chain);
    else groups.push([chain]);
  }
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={t("settings.text.overridesummaryShowWhereThisValueComes", {
                    overrideSummary,
                  })}
                />
              }
            />
          }
        >
          <LayersIcon
            className={cn(
              "size-3",
              state === "overridden" && "text-primary",
              state === "mixed" && "text-warning",
            )}
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{overrideSummary}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" width="md" padding="none">
        <div className="divide-y divide-border/60">
          {groups.map((members) => {
            const first = members[0];
            if (!first) return null;
            const { id, target, machine, layers, winningLayer } = first;
            const chain = (
              <ol role="list" className="text-sm">
                {layers.map((layer) => (
                  <li
                    key={layer.key}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1",
                      layer.effective && "bg-foreground/[0.06]",
                    )}
                  >
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        layer.effective ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {layer.key === "environment" ? t("settings.text.environment") : layer.label}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 tabular-nums",
                        layer.effective
                          ? "text-foreground"
                          : layer.set
                            ? "text-muted-foreground"
                            : "text-muted-foreground/60",
                      )}
                    >
                      <span className="max-w-32 truncate">{layer.value}</span>
                      {layer.effective ? (
                        <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span aria-hidden className="size-3.5 shrink-0" />
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            );
            return (
              <section key={id} className="px-3 py-2.5">
                {!hasMultipleEnvironments ? (
                  <h4 className="flex items-center gap-1.5 pb-1.5 text-xs font-medium text-muted-foreground">
                    <EnvironmentMachineIcon
                      aria-hidden
                      kind={machine}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 truncate">{target.label}</span>
                  </h4>
                ) : null}
                {hasMultipleEnvironments && groups.length > 1 ? (
                  <Collapsible>
                    <CollapsibleTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm-multiline"
                          className="w-full justify-start text-left"
                        />
                      }
                    >
                      <span className="flex w-full min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground tabular-nums">
                            {winningLayer?.value}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {winningLayer?.key === "environment"
                              ? t("settings.text.environment")
                              : winningLayer?.label}
                          </span>
                          <ChevronRightIcon
                            aria-hidden
                            className="size-3 shrink-0 text-muted-foreground [[data-panel-open]_&]:rotate-90"
                          />
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
                          {members.map((member) => (
                            <span
                              key={member.id}
                              className="flex min-w-0 max-w-full items-center gap-1"
                            >
                              <EnvironmentMachineIcon
                                aria-hidden
                                kind={member.machine}
                                className="size-3 shrink-0"
                              />
                              <span className="truncate">{member.label}</span>
                            </span>
                          ))}
                        </span>
                      </span>
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <div className="pt-1.5">{chain}</div>
                    </CollapsiblePanel>
                  </Collapsible>
                ) : (
                  <>
                    {chain}
                    {hasMultipleEnvironments ? (
                      <p className="px-2 pt-1.5 text-xs text-muted-foreground">
                        {t("settings.text.sameOnAllMachines")}
                      </p>
                    ) : null}
                  </>
                )}
                {(() => {
                  const overriding = overridingProjects.filter((project) =>
                    members.some((member) => member.target.environmentId === project.environmentId),
                  );
                  if (overriding.length === 0) return null;
                  const foldOverrides = hasMultipleEnvironments && overriding.length > 3;
                  const header = (
                    <div className="flex items-center justify-between gap-3 px-2 text-xs text-muted-foreground">
                      {foldOverrides ? (
                        <CollapsibleTrigger render={<InlineButton tone="muted" />}>
                          <ChevronRightIcon
                            aria-hidden
                            className="size-3 [[data-panel-open]_&]:rotate-90"
                          />
                          {t("settings.text.overriddenBy")}
                        </CollapsibleTrigger>
                      ) : (
                        <span>{t("settings.text.overriddenBy")}</span>
                      )}
                      {onClearOverrides ? (
                        <InlineButton onClick={() => onClearOverrides(overriding)}>
                          {overriding.length === 1
                            ? t("settings.parallelA.inheritResetIt")
                            : t("settings.text.resetAll")}
                        </InlineButton>
                      ) : null}
                    </div>
                  );
                  const projects = (
                    <ul
                      role="list"
                      className={cn("mt-0.5 text-sm", foldOverrides && "max-h-48 overflow-y-auto")}
                    >
                      {overriding.map((project) => (
                        <li
                          key={`${project.environmentId}:${project.projectId}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-1"
                        >
                          <span className="flex min-w-0 flex-col items-start">
                            <InlineButton
                              className="min-w-0 max-w-full justify-start"
                              onClick={project.open}
                            >
                              <span className="truncate">{project.label}</span>
                            </InlineButton>
                            {hasMultipleEnvironments ? (
                              <span className="max-w-full truncate text-xs text-muted-foreground">
                                {machineLabelFor(project.environmentId)}
                              </span>
                            ) : null}
                          </span>
                          <span className="max-w-32 truncate text-muted-foreground tabular-nums">
                            {isProjectScopedSettingKey(key)
                              ? formatValue(
                                  key,
                                  members.find(
                                    (member) =>
                                      member.target.environmentId === project.environmentId,
                                  )?.overrides[project.projectId]?.[key],
                                  t,
                                )
                              : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  );
                  return (
                    <div className="mt-2 border-t border-border/60 pt-2">
                      {foldOverrides ? (
                        <Collapsible>
                          {header}
                          <CollapsiblePanel>{projects}</CollapsiblePanel>
                        </Collapsible>
                      ) : (
                        <>
                          {header}
                          {projects}
                        </>
                      )}
                    </div>
                  );
                })()}
              </section>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
