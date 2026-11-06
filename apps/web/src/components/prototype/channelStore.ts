// PROTOTYPE, wipe me. Which channels (IM, email) reach which agent. Email is a channel like IM:
// mail to an agent's address lands in its chat, and its replies stay drafts until you send them.
// In-memory only; the real thing is the gateway's channel bindings, set per agent.
import { useSyncExternalStore } from "react";

import { VIEWERS, isEnterprise, type LighthouseViewer } from "./lighthouseData";

export type ChannelId = "codi" | "telegram" | "wechat" | "email" | "slack" | "wecom";

const CHANNELS: ReadonlyArray<{ id: ChannelId; label: string; company?: true }> = [
  { id: "codi", label: "Codi" },
  { id: "telegram", label: "Telegram" },
  { id: "wechat", label: "微信" },
  { id: "email", label: "邮箱" },
  { id: "slack", label: "Slack" },
  { id: "wecom", label: "企业微信", company: true },
];

/** Not connected in any workspace yet; shown so people see where they would go. */
const UNCONNECTED: ReadonlySet<ChannelId> = new Set(["slack", "wecom"]);

export function channelLabel(id: ChannelId): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id;
}

interface ChannelBinding {
  on: boolean;
  handle: string;
}

export type ChannelSet = Readonly<Partial<Record<ChannelId, ChannelBinding>>>;

/** The agent a channel setting belongs to: a viewer's own agent, or a company agent. */
export type ChannelOwner =
  | { kind: "personal"; viewer: LighthouseViewer; agent: string; workspace: string }
  | { kind: "company"; agent: string; workspace: string };

const slug = (viewer: LighthouseViewer) => VIEWERS[viewer].name.split(" ")[0]!.toLowerCase();

function mailDomain(workspace: string) {
  return isEnterprise(workspace) ? `${workspace}.ai` : "gmail.com";
}

const COMPANY_DEFAULTS: Record<string, ChannelSet> = {
  desk: {
    telegram: { on: true, handle: "@dimx_desk_bot" },
    email: { on: true, handle: "desk@dimx.ai" },
  },
  hr: {
    telegram: { on: false, handle: "@dimx_hr_bot" },
    email: { on: true, handle: "hr@dimx.ai" },
  },
  finance: { email: { on: true, handle: "finance@dimx.ai" } },
  legal: { email: { on: false, handle: "legal@dimx.ai" } },
  it: {
    telegram: { on: true, handle: "@dimx_it_bot" },
    email: { on: false, handle: "it@dimx.ai" },
  },
  office: { email: { on: false, handle: "office@dimx.ai" } },
};

function defaults(owner: ChannelOwner): ChannelSet {
  if (owner.kind === "company") return COMPANY_DEFAULTS[owner.agent] ?? {};
  const name = slug(owner.viewer);
  const isCos = owner.agent === "cos";
  const tag = isCos ? "cos" : owner.agent;
  return {
    telegram: { on: isCos, handle: `@${name}_${tag.replace(/-/g, "_")}_bot` },
    wechat: { on: isCos, handle: "已绑定（扫码）" },
    email: {
      on: isCos,
      handle: isEnterprise(owner.workspace)
        ? `${name}+${tag}@${mailDomain(owner.workspace)}`
        : `${name}.${tag}@${mailDomain(owner.workspace)}`,
    },
  };
}

interface Store {
  saved: Readonly<Record<string, ChannelSet>>;
  /** Personal WeChat (ClawBot) binds one agent per account: viewer → agent key. */
  wechat: Readonly<Record<string, string | null>>;
}

let store: Store = { saved: {}, wechat: {} };
const listeners = new Set<() => void>();

function update(patch: Partial<Store>) {
  store = { ...store, ...patch };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const ownerKey = (o: ChannelOwner) =>
  o.kind === "company" ? `company:${o.agent}` : `${o.viewer}:${o.workspace}:${o.agent}`;

function useStore() {
  return useSyncExternalStore(subscribe, () => store);
}

function bindingsIn(s: Store, owner: ChannelOwner): ChannelSet {
  const saved = s.saved[ownerKey(owner)] ?? defaults(owner);
  if (owner.kind === "company") return saved;
  const holder = wechatHolderIn(s, owner.viewer);
  const wechat = saved.wechat;
  return wechat ? { ...saved, wechat: { ...wechat, on: holder === owner.agent } } : saved;
}

function wechatHolderIn(s: Store, viewer: LighthouseViewer): string | null {
  return viewer in s.wechat ? (s.wechat[viewer] ?? null) : "cos";
}

export function useChannels(owner: ChannelOwner): ChannelSet {
  return bindingsIn(useStore(), owner);
}

/** Which of the viewer's agents holds their personal WeChat, if any. */
export function useWechatHolder(viewer: LighthouseViewer): string | null {
  return wechatHolderIn(useStore(), viewer);
}

export function saveChannels(owner: ChannelOwner, next: ChannelSet) {
  const patch: Partial<Store> = { saved: { ...store.saved, [ownerKey(owner)]: next } };
  if (owner.kind === "personal" && next.wechat) {
    const holder = wechatHolderIn(store, owner.viewer);
    if (next.wechat.on) patch.wechat = { ...store.wechat, [owner.viewer]: owner.agent };
    else if (holder === owner.agent) patch.wechat = { ...store.wechat, [owner.viewer]: null };
  }
  update(patch);
}

/**
 * The rows a settings dialog shows. Company agents never get personal WeChat; a personal
 * workspace has no company channels (企业微信, shared mailboxes).
 */
export function channelRows(owner: ChannelOwner) {
  const enterprise = isEnterprise(owner.workspace);
  return CHANNELS.filter((c) => c.id !== "codi")
    .filter((c) => !(owner.kind === "company" && c.id === "wechat"))
    .filter((c) => enterprise || c.company !== true)
    .map((c) => ({ ...c, unconnected: UNCONNECTED.has(c.id) }));
}

/** The address an agent gets before anyone changes it, for mock messages. */
export function defaultHandle(owner: ChannelOwner, id: ChannelId): string {
  return defaults(owner)[id]?.handle ?? "";
}
