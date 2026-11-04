// PROTOTYPE, wipe me. Bottom-left account row, after Claude Code: avatar, name · workspace and a
// menu to switch workspace (企业 or 个人; on Telescope also members and the viewer); settings on the right.
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, SettingsIcon, UsersIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { VIEWERS, WORKSPACES, WORKSPACE_KIND, type LighthouseViewer } from "./lighthouseData";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { setWorkspace, useWorkspaceId } from "./workspaceStore";

export function WorkspaceUserMenu({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const lighthouse = useLighthouseSearch();
  const search = lighthouse ?? normalizeLighthouseSearch({});
  const viewer = VIEWERS[search.as];
  const workspaceId = useWorkspaceId();
  const workspace = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0]!;
  const go = (patch: Partial<typeof search>) =>
    void navigate({ to: "/prototype/lighthouse", search: { ...search, ...patch } });

  return (
    <Menu>
      <MenuTrigger
        aria-label="账号与工作区"
        render={
          <button
            type="button"
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-md p-1 text-start text-sm outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              !compact && "pe-2",
            )}
          />
        }
      >
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {viewer.name[0]}
        </span>
        {compact ? null : (
          <>
            <span className="min-w-0 truncate">
              <span className="font-medium">{viewer.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · {workspace.name} · {WORKSPACE_KIND[workspace.kind]}
              </span>
            </span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start" side="top" sideOffset={6}>
        <MenuGroup>
          <MenuGroupLabel>工作区</MenuGroupLabel>
          <MenuRadioGroup
            value={workspace.id}
            onValueChange={(next) => {
              setWorkspace(String(next));
              if (lighthouse) go({ chat: "mine" });
            }}
          >
            {WORKSPACES.map((w) => (
              <MenuRadioItem key={w.id} value={w.id}>
                <span className="flex flex-1 items-center justify-between gap-3">
                  {w.name}
                  <span className="text-xs text-muted-foreground">{WORKSPACE_KIND[w.kind]}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {lighthouse ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => go({ view: "members" })}>
              <UsersIcon className="size-3.5" />
              成员与授权
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>身份</MenuGroupLabel>
              <MenuRadioGroup
                value={search.as}
                onValueChange={(next) => go({ as: next as LighthouseViewer, chat: "mine" })}
              >
                {(Object.keys(VIEWERS) as Array<LighthouseViewer>).map((k) => (
                  <MenuRadioItem key={k} value={k}>
                    {VIEWERS[k].name} · {VIEWERS[k].title}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export function SettingsIconButton() {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Settings"
            size="icon-sm"
            variant="ghost-muted"
            onClick={() => void navigate({ to: "/settings" })}
          />
        }
      >
        <SettingsIcon />
      </TooltipTrigger>
      <TooltipPopup side="top">Settings</TooltipPopup>
    </Tooltip>
  );
}

/** Lighthouse footer: account row with a top border, settings on the right. */
export function WorkspaceFooter() {
  return (
    <div className="flex shrink-0 items-center justify-between gap-1 border-t px-2 py-2">
      <WorkspaceUserMenu />
      <SettingsIconButton />
    </div>
  );
}
