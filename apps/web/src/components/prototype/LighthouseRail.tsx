// PROTOTYPE, wipe me. Teams-style vertical rail on the Work tab: chats, bots, dashboard, tasks, decisions.
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessagesSquareIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type LighthouseView } from "./lighthouseData";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { SettingsIconButton, WorkspaceUserMenu } from "./WorkspaceFooter";

export const RAIL_ITEMS: ReadonlyArray<{
  id: LighthouseView;
  label: string;
  icon: typeof BotIcon;
  badge?: number;
}> = [
  { id: "chats", label: "对话", icon: MessagesSquareIcon, badge: 4 },
  { id: "projects", label: "项目", icon: FolderGit2Icon },
  { id: "bots", label: "Bots", icon: BotIcon },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { id: "tasks", label: "任务", icon: ListChecksIcon, badge: 2 },
  { id: "decisions", label: "决定", icon: GitBranchIcon },
];

export function LighthouseRail({ collapsed }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const search = useLighthouseSearch() ?? normalizeLighthouseSearch({});
  const view = search.view;
  return (
    <nav
      aria-label="工作区导航"
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-1 py-2",
        collapsed === true && "flex-1",
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
                    search: { ...search, view: item.id },
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
      {collapsed === true ? (
        <div className="mt-auto flex flex-col items-center gap-1">
          <SettingsIconButton />
          <WorkspaceUserMenu compact />
        </div>
      ) : null}
    </nav>
  );
}
