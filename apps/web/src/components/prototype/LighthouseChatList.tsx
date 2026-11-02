// PROTOTYPE, wipe me. On the Work tab the real sidebar body becomes a Teams-style list of
// Chief of Staff chats. Mock data only.
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BotIcon, BuildingIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { chatsFor, type LighthouseChatId, type LighthouseViewer } from "./lighthouseData";

export function BotAvatar({
  tone,
  size = "md",
  readOnly,
}: {
  tone: string;
  size?: "sm" | "md" | "lg";
  readOnly?: boolean;
}) {
  const Icon = readOnly ? BuildingIcon : BotIcon;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full text-white",
        size === "lg" ? "size-10" : size === "sm" ? "size-6" : "size-8",
        tone,
      )}
    >
      <Icon className={size === "lg" ? "size-5" : size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}

export function LighthouseChatList() {
  const navigate = useNavigate();
  const search = useLocation({
    select: (l) => l.search as { as?: LighthouseViewer; chat?: LighthouseChatId; variant?: string },
  });
  const viewer = search.as ?? "admin";
  const current = search.chat ?? "mine";
  const variant = search.variant === "B" || search.variant === "C" ? search.variant : "A";
  const chats = chatsFor(viewer);
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
                  search: { variant, as: viewer, chat: c.id, view: "chats" },
                })
              }
            >
              <span className="relative">
                <BotAvatar tone={c.tone} readOnly={c.readOnly === true} />
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
      <div className="mt-3 px-2 text-2xs text-sidebar-muted-foreground">
        只有你的幕僚长能派活。项目幕僚长回答它那个项目的事；总台只读。
      </div>
    </SidebarGroup>
  );
}
