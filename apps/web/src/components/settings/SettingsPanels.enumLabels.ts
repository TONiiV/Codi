import type {
  AuthClientMetadataDeviceType,
  AuthGrantScope,
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

const AUTH_SCOPE_TEXT_KEYS = {
  "orchestration:read": {
    title: "settings.parallelA.authScopeTitle_orchestrationRead",
    description: "settings.parallelA.authScopeDescription_orchestrationRead",
  },
  "orchestration:operate": {
    title: "settings.parallelA.authScopeTitle_orchestrationOperate",
    description: "settings.parallelA.authScopeDescription_orchestrationOperate",
  },
  "settings:write": {
    title: "settings.parallelA.authScopeTitle_settingsWrite",
    description: "settings.parallelA.authScopeDescription_settingsWrite",
  },
  "providers:manage": {
    title: "settings.parallelA.authScopeTitle_providersManage",
    description: "settings.parallelA.authScopeDescription_providersManage",
  },
  "environment:maintain": {
    title: "settings.parallelA.authScopeTitle_environmentMaintain",
    description: "settings.parallelA.authScopeDescription_environmentMaintain",
  },
  "preview:operate": {
    title: "settings.parallelA.authScopeTitle_previewOperate",
    description: "settings.parallelA.authScopeDescription_previewOperate",
  },
  "diagnostics:read": {
    title: "settings.parallelA.authScopeTitle_diagnosticsRead",
    description: "settings.parallelA.authScopeDescription_diagnosticsRead",
  },
  "terminal:read": {
    title: "settings.parallelA.authScopeTitle_terminalRead",
    description: "settings.parallelA.authScopeDescription_terminalRead",
  },
  "terminal:operate": {
    title: "settings.parallelA.authScopeTitle_terminalOperate",
    description: "settings.parallelA.authScopeDescription_terminalOperate",
  },
  "source-control:write": {
    title: "settings.parallelA.authScopeTitle_sourceControlWrite",
    description: "settings.parallelA.authScopeDescription_sourceControlWrite",
  },
  "filesystem:read": {
    title: "settings.parallelA.authScopeTitle_filesystemRead",
    description: "settings.parallelA.authScopeDescription_filesystemRead",
  },
  "filesystem:write": {
    title: "settings.parallelA.authScopeTitle_filesystemWrite",
    description: "settings.parallelA.authScopeDescription_filesystemWrite",
  },
  "access:read": {
    title: "settings.parallelA.authScopeTitle_accessRead",
    description: "settings.parallelA.authScopeDescription_accessRead",
  },
  "access:write": {
    title: "settings.parallelA.authScopeTitle_accessWrite",
    description: "settings.parallelA.authScopeDescription_accessWrite",
  },
  "relay:read": {
    title: "settings.parallelA.authScopeTitle_relayRead",
    description: "settings.parallelA.authScopeDescription_relayRead",
  },
  "relay:write": {
    title: "settings.parallelA.authScopeTitle_relayWrite",
    description: "settings.parallelA.authScopeDescription_relayWrite",
  },
  "telescope:member": {
    title: "settings.parallelA.authScopeTitle_telescopeMember",
    description: "settings.parallelA.authScopeDescription_telescopeMember",
  },
  "telescope:admin": {
    title: "settings.parallelA.authScopeTitle_telescopeAdmin",
    description: "settings.parallelA.authScopeDescription_telescopeAdmin",
  },
} as const satisfies Record<AuthGrantScope, { title: string; description: string }>;

export function authScopeText(scope: AuthGrantScope, t: TFunction) {
  const keys = AUTH_SCOPE_TEXT_KEYS[scope];
  return { title: t(keys.title), description: t(keys.description) };
}

export function sessionPermissionsUnavailableText(
  input: { readonly connected: boolean; readonly failed: boolean; readonly rejected: boolean },
  t: TFunction,
): string {
  if (!input.connected) return t("settings.parallelA.permNotConnected");
  if (input.rejected) return t("settings.parallelA.permRejected");
  return t(input.failed ? "settings.parallelA.permFailed" : "settings.parallelA.permChecking");
}

const DEVICE_TYPE_KEYS = {
  desktop: "settings.manual.deviceType.desktop",
  mobile: "settings.manual.deviceType.mobile",
  tablet: "settings.manual.deviceType.tablet",
  bot: "settings.manual.deviceType.bot",
} as const satisfies Record<Exclude<AuthClientMetadataDeviceType, "unknown">, string>;

export function deviceTypeText(
  deviceType: Exclude<AuthClientMetadataDeviceType, "unknown">,
  t: TFunction,
): string {
  return t(DEVICE_TYPE_KEYS[deviceType]);
}
