import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronsUpDownIcon, LogInIcon, PlusIcon, RotateCwIcon, UsersIcon } from "lucide-react";
import * as Effect from "effect/Effect";
import { useContext, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  CreateWorkspaceDialog,
  JoinWorkspaceDialog,
  MembersDialog,
} from "./TelescopeAccountDialogs";
import { telescope, useTelescopeWorkspaces, WORKSPACE_KIND_LABEL } from "./telescopeState";

type DialogKind = "create" | "join" | "members";

function AccountMenu({ environmentId }: { environmentId: EnvironmentId }) {
  const { current } = useTelescopeWorkspaces();
  const listQuery = useEnvironmentQuery(telescope.list({ environmentId, input: {} }));
  const workspaces = listQuery.data?.workspaces ?? [];
  const selfQuery = useEnvironmentQuery(
    current === null ? null : telescope.get({ environmentId, input: { workspaceId: current.id } }),
  );
  const self = selfQuery.data?.self ?? null;
  const registry = useContext(RegistryContext);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const listFailed = listQuery.data === null && listQuery.error !== null;
  const loaded = listQuery.data !== null;
  const name =
    self?.displayName ??
    (listFailed || selfQuery.error !== null
      ? "工作区加载失败"
      : loaded && current === null
        ? "未加入工作区"
        : "正在加载…");
  const subtitle = current?.name ?? (loaded ? "新建或加入一个工作区" : "");
  const close = () => setDialog(null);
  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label={current ? `账号与工作区：${name} · ${current.name}` : "账号与工作区"}
          render={
            <button
              type="button"
              className="flex max-w-full min-w-0 items-center gap-2 rounded-md p-1 pe-2 text-start text-sm outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
          }
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {self?.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-medium">{name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{subtitle}</span>
              {current ? (
                <Badge variant="outline" size="sm">
                  {WORKSPACE_KIND_LABEL[current.kind]}
                </Badge>
              ) : null}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </MenuTrigger>
        <MenuPopup align="start" side="top" sideOffset={6}>
          <MenuGroup>
            <MenuGroupLabel>工作区</MenuGroupLabel>
            {current ? (
              <MenuRadioGroup
                value={current.id}
                onValueChange={(next) => {
                  const picked = workspaces.find((workspace) => workspace.id === next);
                  if (picked) {
                    Effect.runSync(telescope.switchTo({ environmentId }, registry, picked.id));
                  }
                }}
              >
                {workspaces.map((workspace) => (
                  <MenuRadioItem key={workspace.id} value={workspace.id} closeOnClick>
                    {workspace.name}
                    <MenuItemDetail>{WORKSPACE_KIND_LABEL[workspace.kind]}</MenuItemDetail>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            ) : null}
            {listFailed || selfQuery.error !== null ? (
              <MenuItem onClick={() => (listFailed ? listQuery.refresh() : selfQuery.refresh())}>
                <RotateCwIcon />
                重新加载
              </MenuItem>
            ) : null}
            <MenuItem onClick={() => setDialog("create")}>
              <PlusIcon />
              新建工作区
            </MenuItem>
            <MenuItem onClick={() => setDialog("join")}>
              <LogInIcon />
              加入工作区
            </MenuItem>
          </MenuGroup>
          {current ? (
            <>
              <MenuSeparator />
              <MenuItem onClick={() => setDialog("members")}>
                <UsersIcon />
                成员与授权
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {dialog === "create" ? (
        <CreateWorkspaceDialog
          environmentId={environmentId}
          defaultName={self?.displayName ?? ""}
          onClose={close}
        />
      ) : dialog === "join" ? (
        <JoinWorkspaceDialog
          environmentId={environmentId}
          defaultName={self?.displayName ?? ""}
          onClose={close}
        />
      ) : dialog === "members" && current ? (
        <MembersDialog
          environmentId={environmentId}
          workspace={current}
          self={self}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/** Telescope's account row; the shared chrome footer below it keeps settings and updates. */
export function TelescopeAccountFooter() {
  const { environmentId } = useTelescopeWorkspaces();
  if (environmentId === null) return null;
  return (
    <div className="flex shrink-0 items-center border-t px-2 pt-2">
      <AccountMenu environmentId={environmentId} />
    </div>
  );
}
