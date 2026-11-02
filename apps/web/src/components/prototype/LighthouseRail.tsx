// PROTOTYPE, wipe me. Teams-style vertical rail on the Work tab: chats, bots, dashboard, tasks.
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BotIcon, LayoutDashboardIcon, ListChecksIcon, MessagesSquareIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type LighthouseChatId,
  type LighthouseView,
  type LighthouseViewer,
} from "./lighthouseData";

export const RAIL_ITEMS: ReadonlyArray<{
  id: LighthouseView;
  label: string;
  icon: typeof BotIcon;
  badge?: number;
}> = [
  { id: "chats", label: "幕僚长们", icon: MessagesSquareIcon, badge: 4 },
  { id: "bots", label: "Bots", icon: BotIcon },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { id: "tasks", label: "任务", icon: ListChecksIcon, badge: 2 },
];

export function LighthouseRail({ collapsed }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const search = useLocation({
    select: (l) =>
      l.search as {
        as?: LighthouseViewer;
        chat?: LighthouseChatId;
        variant?: "A" | "B" | "C";
        view?: LighthouseView;
      },
  });
  const view = search.view ?? "chats";
  return (
    <nav
      aria-label="工作区导航"
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-1 py-2",
        collapsed !== true && "border-e",
      )}
    >
      {RAIL_ITEMS.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <Button
                aria-label={item.label}
                size="icon"
                variant={view === item.id ? "secondary" : "ghost-muted"}
                className="relative"
                onClick={() =>
                  void navigate({
                    to: "/prototype/lighthouse",
                    search: {
                      variant: search.variant ?? "A",
                      as: search.as ?? "admin",
                      chat: search.chat ?? "mine",
                      view: item.id,
                    },
                  })
                }
              />
            }
          >
            <item.icon />
            {item.badge ? (
              <span className="absolute end-0.5 top-0.5 size-2 rounded-full bg-destructive" />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="right">{item.label}</TooltipPopup>
        </Tooltip>
      ))}
    </nav>
  );
}
