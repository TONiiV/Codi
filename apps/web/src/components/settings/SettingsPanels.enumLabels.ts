import type {
  ProjectIconColor,
  RuntimeMode,
  SidebarProjectGroupingMode,
  WorktreeSubmodules,
} from "@t3tools/contracts";
import type { TFunction } from "i18next";

import type { EnvMode } from "../BranchToolbar.logic";

// Settings resolves these labels by key; the shared English label maps stay untranslated for
// surfaces that are not translated yet.

const P = "settings.parallelA.";

const RUNTIME_MODE_KEYS: Record<RuntimeMode, string> = {
  "approval-required": "runtimeSupervised",
  "auto-accept-edits": "runtimeAutoAcceptEdits",
  auto: "runtimeAuto",
  "full-access": "runtimeFullAccess",
};

export function runtimeModeText(mode: RuntimeMode, t: TFunction) {
  const key = RUNTIME_MODE_KEYS[mode];
  return { label: t(`${P}${key}`), description: t(`${P}${key}Desc`) };
}

export function envModeText(mode: EnvMode, t: TFunction): string {
  return t(`${P}${mode === "worktree" ? "envModeWorktree" : "envModeLocal"}`);
}

const SUBMODULE_KEYS: Record<WorktreeSubmodules, string> = {
  recursive: "submodulesRecursive",
  "top-level": "submodulesTopLevel",
  none: "submodulesNone",
};

export function worktreeSubmodulesText(value: WorktreeSubmodules, t: TFunction): string {
  return t(`${P}${SUBMODULE_KEYS[value]}`);
}

const PROJECT_GROUPING_MODE_KEYS = {
  repository: "settings.parallelA.groupingRepository",
  repository_path: "settings.parallelA.groupingRepositoryPath",
  separate: "settings.parallelA.groupingSeparate",
} as const satisfies Record<SidebarProjectGroupingMode, string>;

export function projectGroupingModeText(mode: SidebarProjectGroupingMode, t: TFunction): string {
  return t(PROJECT_GROUPING_MODE_KEYS[mode]);
}

const PROJECT_ICON_COLOR_KEYS = {
  gray: "settings.text.iconColorNames.gray",
  red: "settings.text.iconColorNames.red",
  orange: "settings.text.iconColorNames.orange",
  amber: "settings.text.iconColorNames.amber",
  yellow: "settings.text.iconColorNames.yellow",
  lime: "settings.text.iconColorNames.lime",
  green: "settings.text.iconColorNames.green",
  emerald: "settings.text.iconColorNames.emerald",
  teal: "settings.text.iconColorNames.teal",
  cyan: "settings.text.iconColorNames.cyan",
  sky: "settings.text.iconColorNames.sky",
  blue: "settings.text.iconColorNames.blue",
  indigo: "settings.text.iconColorNames.indigo",
  violet: "settings.text.iconColorNames.violet",
  purple: "settings.text.iconColorNames.purple",
  fuchsia: "settings.text.iconColorNames.fuchsia",
  pink: "settings.text.iconColorNames.pink",
  rose: "settings.text.iconColorNames.rose",
} as const satisfies Record<ProjectIconColor, string>;

export function projectIconColorText(color: ProjectIconColor, t: TFunction): string {
  return t(PROJECT_ICON_COLOR_KEYS[color]);
}

export function mergeMethodText(method: "merge" | "squash" | "rebase", t: TFunction): string {
  return t(`${P}mergeMethod${method[0]!.toUpperCase()}${method.slice(1)}`);
}
