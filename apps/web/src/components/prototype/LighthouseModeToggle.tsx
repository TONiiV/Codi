// PROTOTYPE, wipe me. Top-left switch between Lighthouse (Work) and Code, like Claude's app.
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BotMessageSquareIcon, CodeXmlIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LighthouseModeToggle({ vertical }: { vertical?: boolean }) {
  const navigate = useNavigate();
  const onWork = useLocation({
    select: (l) => l.pathname.startsWith("/prototype/lighthouse"),
  });
  const items = [
    {
      id: "work",
      label: "Lighthouse",
      icon: BotMessageSquareIcon,
      active: onWork,
      go: () =>
        void navigate({
          to: "/prototype/lighthouse",
          search: { variant: "A", as: "admin", chat: "mine", view: "chats" },
        }),
    },
    {
      id: "code",
      label: "Code",
      icon: CodeXmlIcon,
      active: !onWork,
      go: () => void navigate({ to: "/" }),
    },
  ];
  return (
    <div
      role="group"
      aria-label="Lighthouse or Code"
      className={cn(
        "flex items-center gap-0.5 rounded-md border bg-sidebar p-0.5 [-webkit-app-region:no-drag]",
        vertical && "flex-col",
      )}
    >
      {items.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <Button
                aria-label={item.label}
                aria-pressed={item.active}
                size="icon-xs"
                variant={item.active ? "secondary" : "ghost-muted"}
                onClick={item.active ? undefined : item.go}
              />
            }
          >
            <item.icon />
          </TooltipTrigger>
          <TooltipPopup side={vertical ? "right" : "bottom"}>{item.label}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
