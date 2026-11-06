import type { WorktreeSubmodules } from "@t3tools/contracts";
import type { TFunction } from "i18next";

import type { EnvMode } from "../BranchToolbar.logic";

// Settings resolves these labels by key; the shared English label maps stay untranslated for
// surfaces that are not translated yet.

const P = "settings.parallelA.";

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

export function mergeMethodText(method: "merge" | "squash" | "rebase", t: TFunction): string {
  return t(`${P}mergeMethod${method[0]!.toUpperCase()}${method.slice(1)}`);
}
