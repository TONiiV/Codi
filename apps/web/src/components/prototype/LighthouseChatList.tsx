// PROTOTYPE, wipe me. On the Telescope tab the real sidebar body becomes a list of chats: pending
// workspace invites pinned on top, then two collapsible groups: 我的 Agents (个人助理, the viewer's
// Chief Agents, custom agents) and, in an enterprise workspace only, 公司 agents.
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useRegistryVersion } from "./lighthouseActions";
import { AddAgentDialog } from "./LighthouseTeams";
import { chatsFor, type LighthouseChat, type LighthouseViewer } from "./lighthouseData";
import { Bloub, type AgentState } from "./LighthouseBloub";
import { ChannelIcon } from "./LighthouseChannels";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { PersonAvatar } from "./WorkspaceInviteChat";
import { inviteChatId, usePendingInvites, useWorkspaceId } from "./workspaceStore";

export function BotAvatar({
  seed,
  size = "md",
  state,
}: {
  seed: string;
  size?: "xs" | "sm" | "md" | "lg";
  state?: AgentState;
}) {
  return (
    <Bloub
      seed={seed}
      state={state ?? "idle"}
      className={
        size === "lg" ? "size-10" : size === "sm" ? "size-6" : size === "xs" ? "size-4" : "size-8"
      }
    />
  );
}

const chatsWith = (viewer: LighthouseViewer, workspace: string, _version: number) =>
  chatsFor(viewer, workspace);

const GROUPS = [
  { id: "mine", label: "我的 Agents", has: (c: LighthouseChat) => c.company !== true },
  { id: "company", label: "公司 agents", has: (c: LighthouseChat) => c.company === true },
] as const;

type GroupId = (typeof GROUPS)[number]["id"];

const FOLD_KEY = "lighthouse-prototype-folded-groups";

function readFolded(): ReadonlyArray<GroupId> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]");
    return Array.isArray(raw) ? GROUPS.map((g) => g.id).filter((id) => raw.includes(id)) : [];
  } catch {
    // Storage can be blocked or hold junk; start with every group open.
    return [];
  }
}

function writeFolded(folded: ReadonlyArray<GroupId>) {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folded));
  } catch {
    // Keep the in-memory choice when storage is blocked.
  }
}

function roleTag(c: LighthouseChat): string | null {
  if (c.id === "mine") return "个人助理";
  if (c.custom === true) return "自定义";
  return null;
}

export function LighthouseChatList() {
  const navigate = useNavigate();
  const search = useLighthouseSearch() ?? normalizeLighthouseSearch({});
  const viewer = search.as;
  const current = search.chat;
  const workspace = useWorkspaceId();
  const chats = chatsWith(viewer, workspace, useRegistryVersion());
  const invites = usePendingInvites(viewer);
  const [folded, setFolded] = useState(readFolded);
  const [adding, setAdding] = useState(false);
  const toggle = (id: GroupId) => {
    const next = folded.includes(id) ? folded.filter((g) => g !== id) : [...folded, id];
    setFolded(next);
    writeFolded(next);
  };
  const open = (chat: string) =>
    void navigate({ to: "/prototype/lighthouse", search: { as: viewer, chat, view: "chats" } });
  return (
    <SidebarGroup className="flex-1" role="presentation">
      {invites.length > 0 ? (
        <SidebarMenu aria-label="工作区邀请" className="mb-2">
          {invites.map((invite) => (
            <SidebarMenuItem key={invite.code}>
              <SidebarMenuButton
                isActive={inviteChatId(invite) === current}
                size="lg"
                className="h-auto items-start"
                onClick={() => open(inviteChatId(invite))}
              >
                <PersonAvatar name={invite.from} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{invite.workspace.name}</span>
                    <span className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums">
                      {invite.at}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-sidebar-muted-foreground">
                      工作区邀请 · {invite.from} 邀请你以{invite.role}身份加入
                    </span>
                    <span
                      role="img"
                      aria-label="未读"
                      className="size-2 shrink-0 rounded-full bg-primary"
                    />
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      ) : null}
      {GROUPS.map((group) => {
        const rows = chats.filter(group.has);
        if (rows.length === 0) return null;
        const shut = folded.includes(group.id);
        return (
          <section key={group.id} className="mb-2">
            <div className="flex items-center gap-1 pe-1">
              <button
                type="button"
                aria-expanded={!shut}
                onClick={() => toggle(group.id)}
                className="flex flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 transition-transform motion-reduce:transition-none",
                    !shut && "rotate-90",
                  )}
                />
                {group.label}
                <span className="tabular-nums">{rows.length}</span>
              </button>
              {group.id === "mine" ? (
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="添加 agent"
                  onClick={() => setAdding(true)}
                >
                  <PlusIcon />
                </Button>
              ) : null}
            </div>
            {shut ? null : (
              <SidebarMenu className="mt-1">
                {rows.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      isActive={c.id === current}
                      size="lg"
                      className="h-auto items-start"
                      onClick={() => open(c.id)}
                    >
                      <span className="relative">
                        <BotAvatar
                          seed={c.name}
                          state={!c.online ? "sleeping" : c.unread > 0 ? "waiting" : "idle"}
                        />
                        <span
                          className={cn(
                            "absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar",
                            c.online ? "bg-success" : "bg-muted-foreground",
                          )}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{c.name}</span>
                          <span className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums">
                            {c.time}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1 text-xs text-sidebar-muted-foreground">
                            {c.channel ? <ChannelIcon id={c.channel} /> : null}
                            <span className="truncate">
                              {roleTag(c) ? `${roleTag(c)} · ` : ""}
                              {c.last}
                            </span>
                          </span>
                          {c.unread > 0 ? (
                            <Badge size="sm" className="shrink-0">
                              {c.unread}
                            </Badge>
                          ) : null}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </section>
        );
      })}
      {adding ? (
        <AddAgentDialog
          viewer={viewer}
          workspace={workspace}
          onClose={() => setAdding(false)}
          onAdded={(chat) => {
            setAdding(false);
            open(chat);
          }}
        />
      ) : null}
    </SidebarGroup>
  );
}
