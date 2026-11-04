// PROTOTYPE, wipe me. The current workspace, shared by Code and Lighthouse and kept per browser,
// plus workspaces created in this tab and invites, which are the only way to join one.
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
  to: LighthouseViewer;
  at: string;
  note: string;
  /** People and agents already in the workspace. */
  members: ReadonlyArray<string>;
}

const INVITES: ReadonlyArray<WorkspaceInvite> = [
  {
    code: "GRIP-7Q2K",
    workspace: { id: "griplab", name: "Gripper Lab", kind: "enterprise" },
    from: "Max",
    role: "成员",
    to: "admin",
    at: "10:41",
    note: "夹爪第二版要开工了，想请你一起看软件这块。任务板已经建好。",
    members: ["Max · 管理员", "Keting Chen · 成员", "主代理"],
  },
  {
    code: "NOVA-3K8D",
    workspace: { id: "nova", name: "Nova Studio", kind: "enterprise" },
    from: "Keting Chen",
    role: "项目负责人",
    to: "admin",
    at: "昨天",
    note: "Nova 的官网改版想交给你带，先拉你进来。",
    members: ["Keting Chen · 管理员", "主代理", "设计代理"],
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

const INVITE_CHAT = "invite-";

export const inviteChatId = (invite: WorkspaceInvite) => INVITE_CHAT + invite.code;

/** Invites addressed to the viewer that are not answered yet. */
export function usePendingInvites(viewer: LighthouseViewer): ReadonlyArray<WorkspaceInvite> {
  const { decided } = useSnapshot();
  return INVITES.filter((i) => i.to === viewer && decided[i.code] === undefined);
}

/** The pending invite a chat id points at, if any. */
export function usePendingInvite(
  viewer: LighthouseViewer,
  chat: string,
): WorkspaceInvite | undefined {
  return usePendingInvites(viewer).find((i) => inviteChatId(i) === chat);
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
