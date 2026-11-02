// PROTOTYPE, wipe me. The current workspace, shared by Code and Lighthouse and kept per browser.
// A Code project belongs to a workspace by a name rule here; one that matches no rule is unbound
// and shows in Code under every workspace.
import { useSyncExternalStore } from "react";

import { WORKSPACES } from "./lighthouseData";

const KEY = "lighthouse-prototype-workspace";
const listeners = new Set<() => void>();

function read(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && WORKSPACES.some((w) => w.id === v)) return v;
  } catch {
    // Storage can be blocked; fall back to the first workspace.
  }
  return WORKSPACES[0]!.id;
}

let current = read();

export function setWorkspace(id: string) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Keep the in-memory choice when storage is blocked.
  }
  for (const l of listeners) l();
}

export function useWorkspaceId(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

const CODE_PROJECT_RULES: ReadonlyArray<{ workspace: string; match: RegExp }> = [
  { workspace: "toniiv", match: /codi|t3code|site|官网|app|移动/i },
  { workspace: "dimx", match: /dimension|gripper|夹爪|tactile|触觉|robot|esp32/i },
];

/** Code shows a project when it is unbound or bound to the current workspace. */
export function isCodeProjectInWorkspace(displayName: string, workspace: string): boolean {
  const rule = CODE_PROJECT_RULES.find((r) => r.match.test(displayName));
  return rule === undefined || rule.workspace === workspace;
}
