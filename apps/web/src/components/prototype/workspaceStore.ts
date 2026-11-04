// PROTOTYPE, wipe me. The current workspace, shared by Code and Lighthouse and kept per browser,
// plus workspaces created or joined in this tab and pending workspace invites.
// A Code project belongs to a workspace by a name rule here; one that matches no rule is unbound
// and shows in Code under every workspace.
import { useSyncExternalStore } from "react";

import {
  VIEWERS,
  WORKSPACES,
  addWorkspace,
  type LighthouseViewer,
  type LighthouseWorkspace,
} from "./lighthouseData";

const KEY = "lighthouse-prototype-workspace";
const listeners = new Set<() => void>();

export interface WorkspaceInvite {
  code: string;
  workspace: LighthouseWorkspace;
  from: string;
  role: string;
  /** The viewer it was sent to; null for a code shared by link only. */
  to: LighthouseViewer | null;
}

const INVITES: ReadonlyArray<WorkspaceInvite> = [
  {
    code: "GRIP-7Q2K",
    workspace: { id: "griplab", name: "Gripper Lab", kind: "enterprise" },
    from: "Max",
    role: "成员",
    to: "admin",
  },
  {
    code: "NOVA-3K8D",
    workspace: { id: "nova", name: "Nova Studio", kind: "enterprise" },
    from: "Keting Chen",
    role: "成员",
    to: null,
  },
];

function read(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && WORKSPACES.some((w) => w.id === v)) return v;
  } catch {
    // Storage can be blocked; fall back to the first workspace.
  }
  return WORKSPACES[0]!.id;
}

interface Snapshot {
  current: string;
  workspaces: ReadonlyArray<LighthouseWorkspace>;
  decided: Readonly<Record<string, "accepted" | "declined">>;
}

let snapshot: Snapshot = { current: read(), workspaces: [...WORKSPACES], decided: {} };

function commit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch, workspaces: [...WORKSPACES] };
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function useSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function setWorkspace(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Keep the in-memory choice when storage is blocked.
  }
  commit({ current: id });
}

export function useWorkspaceId(): string {
  return useSnapshot().current;
}

export function useWorkspaces(): ReadonlyArray<LighthouseWorkspace> {
  return useSnapshot().workspaces;
}

/** Pending and declined invites addressed to the viewer. */
export function useInvites(viewer: LighthouseViewer) {
  const { decided } = useSnapshot();
  const mine = INVITES.filter((i) => i.to === viewer);
  return {
    pending: mine.filter((i) => decided[i.code] === undefined),
    declined: mine.filter((i) => decided[i.code] === "declined"),
  };
}

/** Finds an invite by its code, alone or inside a join link. */
export function findInvite(text: string): WorkspaceInvite | undefined {
  const code = /[A-Z0-9]{4}-[A-Z0-9]{4}/i.exec(text.trim())?.[0]?.toUpperCase();
  return code ? INVITES.find((i) => i.code === code) : undefined;
}

export function isMemberOf(workspace: string): boolean {
  return WORKSPACES.some((w) => w.id === workspace);
}

export function acceptInvite(invite: WorkspaceInvite) {
  addWorkspace(invite.workspace, { viewer: null, name: invite.from });
  try {
    localStorage.setItem(KEY, invite.workspace.id);
  } catch {
    // Keep the in-memory choice when storage is blocked.
  }
  commit({
    current: invite.workspace.id,
    decided: { ...snapshot.decided, [invite.code]: "accepted" },
  });
}

export function declineInvite(invite: WorkspaceInvite) {
  commit({ decided: { ...snapshot.decided, [invite.code]: "declined" } });
}

export function restoreInvite(invite: WorkspaceInvite) {
  const { [invite.code]: _gone, ...rest } = snapshot.decided;
  commit({ decided: rest });
}

let created = 0;

/** The creator becomes the admin of an enterprise workspace, which starts with 主代理 only. */
export function createWorkspace(
  name: string,
  kind: LighthouseWorkspace["kind"],
  viewer: LighthouseViewer,
) {
  created += 1;
  const id = `ws-${created}`;
  addWorkspace({ id, name, kind }, { viewer, name: VIEWERS[viewer].name });
  setWorkspace(id);
  return id;
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
