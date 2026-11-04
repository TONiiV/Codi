// PROTOTYPE, wipe me. On the Work tab the real sidebar body becomes a Teams-style list of
// chats: the viewer's Chief of Staff (总幕僚长), their own Chief Agent in each project, and the
// company's agents (the main agent plus department agents), which are a separate set.
import { useNavigate } from "@tanstack/react-router";
import { Fragment } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useRegistryVersion } from "./lighthouseActions";
import { chatsFor, type LighthouseChat, type LighthouseViewer } from "./lighthouseData";
import { Bloub, type AgentState } from "./LighthouseBloub";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { useWorkspaceId } from "./workspaceStore";

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

const SECTIONS = [
  { label: "Chief of Staff · 总幕僚长", has: (c: LighthouseChat) => c.id === "mine" },
  {
    label: "我的 Chief Agent",
    has: (c: LighthouseChat) => c.id !== "mine" && c.company !== true,
  },
  { label: "公司 agents", has: (c: LighthouseChat) => c.company === true },
];

export function LighthouseChatList() {
  const navigate = useNavigate();
  const search = useLighthouseSearch() ?? normalizeLighthouseSearch({});
  const viewer = search.as;
  const current = search.chat;
  const workspace = useWorkspaceId();
  const chats = chatsWith(viewer, workspace, useRegistryVersion());
  return (
    <SidebarGroup className="flex-1" role="presentation">
      {SECTIONS.map((section) => {
        const rows = chats.filter(section.has);
        return rows.length === 0 ? null : (
          <Fragment key={section.label}>
            <div className="px-2 pt-1 pb-2 text-xs font-medium text-sidebar-muted-foreground">
              {section.label}
            </div>
            <SidebarMenu className="mb-3">
              {rows.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    isActive={c.id === current}
                    size="lg"
                    className="h-auto items-start"
                    onClick={() =>
                      void navigate({
                        to: "/prototype/lighthouse",
                        search: { as: viewer, chat: c.id, view: "chats" },
                      })
                    }
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
                        <span className="truncate text-xs text-sidebar-muted-foreground">
                          {c.last}
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
          </Fragment>
        );
      })}
    </SidebarGroup>
  );
}
