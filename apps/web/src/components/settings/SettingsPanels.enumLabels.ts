import type { RuntimeMode, WorktreeSubmodules } from "@t3tools/contracts";
import {
  resolveEnvModeLabel,
  WORKTREE_SUBMODULES_LABELS,
  type EnvMode,
} from "../BranchToolbar.logic";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import type { TFunction } from "i18next";

// The English sources (chat runtimeModeConfig, BranchToolbar.logic, shared authScopeOptions) are
// shared with surfaces that do not translate yet, so settings resolves its own copy by key and
// falls back to the shared English.

const P = "settings.parallelA.";

const RUNTIME_MODE_KEYS: Record<RuntimeMode, string> = {
  "approval-required": "runtimeSupervised",
  "auto-accept-edits": "runtimeAutoAcceptEdits",
  auto: "runtimeAuto",
  "full-access": "runtimeFullAccess",
};

export function runtimeModeText(mode: RuntimeMode, t: TFunction) {
  const key = RUNTIME_MODE_KEYS[mode];
  const { label, description } = runtimeModeConfig[mode];
  return {
    label: t(`${P}${key}`, { defaultValue: label }),
    description: t(`${P}${key}Desc`, { defaultValue: description }),
  };
}

export function envModeText(mode: EnvMode, t: TFunction): string {
  return t(`${P}${mode === "worktree" ? "envModeWorktree" : "envModeLocal"}`, {
    defaultValue: resolveEnvModeLabel(mode),
  });
}

const SUBMODULE_KEYS: Record<WorktreeSubmodules, string> = {
  recursive: "submodulesRecursive",
  "top-level": "submodulesTopLevel",
  none: "submodulesNone",
};

export function worktreeSubmodulesText(value: WorktreeSubmodules, t: TFunction): string {
  return t(`${P}${SUBMODULE_KEYS[value]}`, { defaultValue: WORKTREE_SUBMODULES_LABELS[value] });
}

export function mergeMethodText(method: "merge" | "squash" | "rebase", t: TFunction): string {
  return t(`${P}mergeMethod${method[0]!.toUpperCase()}${method.slice(1)}`, {
    defaultValue: PULL_REQUEST_MERGE_METHOD_LABELS[method],
  });
}

/** Falls back to the shared English copy for a scope without a translation. */
export function authScopeText(
  option: { readonly scope: string; readonly title: string; readonly description: string },
  t: TFunction,
) {
  const id = option.scope.replace(/[:-](w)/g, (_, character: string) => character.toUpperCase());
  return {
    title: t(`${P}authScopeTitle_${id}`, { defaultValue: option.title }),
    description: t(`${P}authScopeDescription_${id}`, { defaultValue: option.description }),
  };
}

export function sessionPermissionsUnavailableText(
  input: { readonly connected: boolean; readonly failed: boolean; readonly rejected: boolean },
  t: TFunction,
): string {
  if (!input.connected) return t(`${P}permNotConnected`);
  if (input.rejected) return t(`${P}permRejected`);
  return t(`${P}${input.failed ? "permFailed" : "permChecking"}`);
}
