// PROTOTYPE, wipe me. On the Work tab the real sidebar body becomes a Teams-style list of
// Chief of Staff chats. Mock data only.
import { useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { chatsFor } from "./lighthouseData";
import { Mascot, type MascotKind, type MascotState } from "./LighthouseMascot";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { useWorkspaceId } from "./workspaceStore";

export function BotAvatar({
  tone,
  size = "md",
  readOnly,
  kind,
  state,
}: {
  tone: string;
  size?: "xs" | "sm" | "md" | "lg";
  readOnly?: boolean;
  kind?: MascotKind;
  state?: MascotState;
}) {
  const mascot = kind ?? (readOnly ? "seal" : tone === "bg-foreground" ? "owl" : "otter");
  return (
    <Mascot
      kind={mascot}
      state={state ?? "idle"}
      framed={mascot !== "otter"}
      className={cn(
        "rounded-full",
        size === "lg" ? "size-10" : size === "sm" ? "size-6" : size === "xs" ? "size-4" : "size-8",
        mascot === "otter" && tone,
      )}
    />
  );
}

export function LighthouseChatList() {
  const navigate = useNavigate();
  const search = useLighthouseSearch() ?? normalizeLighthouseSearch({});
  const viewer = search.as;
  const current = search.chat;
  const workspace = useWorkspaceId();
  const chats = chatsFor(viewer, workspace);
  return (
    <SidebarGroup className="flex-1" role="presentation">
      <div className="px-2 pt-1 pb-2 text-xs font-medium text-sidebar-muted-foreground">幕僚长</div>
      <SidebarMenu>
        {chats.map((c) => (
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
                  tone={c.tone}
                  readOnly={c.readOnly === true}
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
                  <span className="truncate text-xs text-sidebar-muted-foreground">{c.last}</span>
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
    </SidebarGroup>
  );
}
