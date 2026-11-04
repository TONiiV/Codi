// PROTOTYPE, wipe me. Bottom-left account row, after Claude Code: avatar, name over workspace and a
// menu to answer invites, switch, create or join a workspace (on Telescope also members and the
// viewer); settings on the right.
import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  LogInIcon,
  PlusIcon,
  SettingsIcon,
  Undo2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
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
import { VIEWERS, WORKSPACE_KIND, type LighthouseViewer } from "./lighthouseData";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { CreateWorkspaceDialog, JoinWorkspaceDialog } from "./WorkspaceDialogs";
import {
  acceptInvite,
  declineInvite,
  restoreInvite,
  setWorkspace,
  useInvites,
  useWorkspaceId,
  useWorkspaces,
} from "./workspaceStore";

export function WorkspaceUserMenu({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const lighthouse = useLighthouseSearch();
  const search = lighthouse ?? normalizeLighthouseSearch({});
  const viewer = VIEWERS[search.as];
  const workspaceId = useWorkspaceId();
  const workspaces = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0]!;
  const invites = useInvites(search.as);
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const go = (patch: Partial<typeof search>) =>
    void navigate({ to: "/prototype/lighthouse", search: { ...search, ...patch } });
  const toMine = () => {
    if (lighthouse) go({ chat: "mine" });
  };
  const inviteNote = invites.pending.length > 0 ? `，${invites.pending.length} 个工作区邀请` : "";

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label={`账号与工作区：${viewer.name} · ${workspace.name}（${WORKSPACE_KIND[workspace.kind]}）${inviteNote}`}
          render={
            <button
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md p-1 text-start text-sm outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                !compact && "flex-1 pe-2",
              )}
            />
          }
        >
          <span className="relative shrink-0">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              {viewer.name[0]}
            </span>
            {invites.pending.length > 0 ? (
              <span className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-sidebar" />
            ) : null}
          </span>
          {compact ? null : (
            <>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate font-medium">{viewer.name}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{workspace.name}</span>
                  <Badge variant="outline" size="sm">
                    {WORKSPACE_KIND[workspace.kind]}
                  </Badge>
                </span>
              </span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </MenuTrigger>
        <MenuPopup align="start" side="top" sideOffset={6}>
          {invites.pending.map((invite) => (
            <MenuGroup key={invite.code}>
              <MenuGroupLabel>
                {invite.from} 邀请你加入 {invite.workspace.name}（
                {WORKSPACE_KIND[invite.workspace.kind]} · {invite.role}）
              </MenuGroupLabel>
              <MenuItem
                onClick={() => {
                  acceptInvite(invite);
                  toMine();
                }}
              >
                <CheckIcon className="size-3.5" />
                接受并进入
              </MenuItem>
              <MenuItem onClick={() => declineInvite(invite)}>
                <XIcon className="size-3.5" />
                拒绝
              </MenuItem>
              <MenuSeparator />
            </MenuGroup>
          ))}
          <MenuGroup>
            <MenuGroupLabel>工作区</MenuGroupLabel>
            <MenuRadioGroup
              value={workspace.id}
              onValueChange={(next) => {
                setWorkspace(String(next));
                toMine();
              }}
            >
              {workspaces.map((w) => (
                <MenuRadioItem key={w.id} value={w.id}>
                  <span className="flex flex-1 items-center justify-between gap-3">
                    {w.name}
                    <span className="text-xs text-muted-foreground">{WORKSPACE_KIND[w.kind]}</span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            <MenuItem onClick={() => setDialog("create")}>
              <PlusIcon className="size-3.5" />
              新建工作区
            </MenuItem>
            <MenuItem onClick={() => setDialog("join")}>
              <LogInIcon className="size-3.5" />
              加入工作区
            </MenuItem>
          </MenuGroup>
          {invites.declined.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>已拒绝的邀请</MenuGroupLabel>
                {invites.declined.map((invite) => (
                  <MenuItem key={invite.code} onClick={() => restoreInvite(invite)}>
                    <Undo2Icon className="size-3.5" />
                    恢复 {invite.workspace.name} 的邀请
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          ) : null}
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
      {dialog === "create" ? (
        <CreateWorkspaceDialog
          viewer={search.as}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toMine();
          }}
        />
      ) : null}
      {dialog === "join" ? (
        <JoinWorkspaceDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toMine();
          }}
        />
      ) : null}
    </>
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
