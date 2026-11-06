import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { isEnvironmentOwner } from "@t3tools/client-runtime/telescope/workspaces";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, LogInIcon, PlusIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { telescope, useTelescopeWorkspaces, WORKSPACE_KIND_LABEL } from "./telescopeState";

const WORKSPACE_ROLE_LABEL = {
  admin: "管理员",
  department_lead: "部门负责人",
  project_lead: "项目负责人",
  member: "成员",
} as const;

const KIND_HINT = {
  enterprise: "你是这个工作区的管理员，可以邀请成员、给项目分配工作区。",
  personal: "只有你自己，适合个人项目。",
} as const;

type DialogKind = "create" | "join" | "members";

function FormDialog({
  title,
  description,
  submitLabel,
  canSubmit,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">{children}</div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost-muted" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Label className="flex flex-col items-stretch" htmlFor={id}>
      {props.label}
      <Input
        nativeInput
        id={id}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </Label>
  );
}

function CreateWorkspaceDialog(props: {
  environmentId: EnvironmentId;
  defaultName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(props.defaultName);
  const [kind, setKind] = useState<Telescope.Workspace["kind"]>("enterprise");
  const [busy, setBusy] = useState(false);
  const create = useAtomCommand(telescope.create, "新建工作区");
  return (
    <FormDialog
      title="新建工作区"
      description="工作区分企业和个人。建好后马上切换过去。"
      submitLabel="新建"
      canSubmit={!busy && name.trim() !== "" && displayName.trim() !== ""}
      onClose={props.onClose}
      onSubmit={async () => {
        setBusy(true);
        const result = await create({
          environmentId: props.environmentId,
          input: { kind, name: name.trim(), displayName: displayName.trim() },
        });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
      }}
    >
      <TextField
        label="名字"
        autoFocus
        placeholder="例如 Gripper Lab"
        value={name}
        onChange={setName}
      />
      <div className="flex flex-col gap-2">
        <ToggleGroup
          aria-label="工作区类型"
          value={[kind]}
          onValueChange={(next) => {
            if (next[0] === "enterprise" || next[0] === "personal") setKind(next[0]);
          }}
        >
          <Toggle value="enterprise">企业</Toggle>
          <Toggle value="personal">个人</Toggle>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
      </div>
      <TextField label="你在工作区里的名字" value={displayName} onChange={setDisplayName} />
    </FormDialog>
  );
}

function JoinWorkspaceDialog(props: {
  environmentId: EnvironmentId;
  defaultName: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(props.defaultName);
  const [busy, setBusy] = useState(false);
  const accept = useAtomCommand(telescope.accept, "加入工作区");
  return (
    <FormDialog
      title="加入工作区"
      description="填入管理员发给你的邀请码。加入后马上切换过去。"
      submitLabel="加入"
      canSubmit={!busy && code.trim() !== "" && displayName.trim() !== ""}
      onClose={props.onClose}
      onSubmit={async () => {
        setBusy(true);
        const result = await accept({
          environmentId: props.environmentId,
          input: { code: code.trim(), displayName: displayName.trim() },
        });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
      }}
    >
      <TextField label="邀请码" autoFocus value={code} onChange={setCode} />
      <TextField label="你在工作区里的名字" value={displayName} onChange={setDisplayName} />
    </FormDialog>
  );
}

function MembersDialog(props: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member | null;
  onClose: () => void;
}) {
  const target = { environmentId: props.environmentId, input: { workspaceId: props.workspace.id } };
  const members = useEnvironmentQuery(telescope.members(target)).data?.members ?? [];
  const mayInvite = useAtomValue(telescope.invite.permissionAtom(props.environmentId));
  const mayRevoke = useAtomValue(telescope.revoke.permissionAtom(props.environmentId));
  const isAdmin = props.self?.role === "admin";
  const invite = useAtomCommand(telescope.invite, "生成邀请码");
  const revoke = useAtomCommand(telescope.revoke, "移除成员");
  const [code, setCode] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const active = members.filter((member) => member.revokedAt === undefined);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>成员与授权</DialogTitle>
          <DialogDescription>
            {props.workspace.name} 的成员。只有管理员可以邀请和移除成员。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ul className="flex flex-col divide-y">
            {active.map((member) => (
              <li key={member.subjectId} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{member.displayName}</span>
                <Badge variant="outline" size="sm">
                  {WORKSPACE_ROLE_LABEL[member.role]}
                </Badge>
                {member.subjectId === props.self?.subjectId || isEnvironmentOwner(member) ? null : (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    disabled={!isAdmin || !mayRevoke}
                    onClick={() =>
                      void revoke({
                        ...target,
                        input: { ...target.input, subjectId: member.subjectId },
                      })
                    }
                  >
                    移除
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {code === null ? null : (
            <div className="mt-4 flex items-center gap-2">
              <Input nativeInput readOnly aria-label="邀请码" value={code} />
              <Button variant="outline" onClick={() => copyToClipboard(code, undefined)}>
                {isCopied ? "已复制" : "复制"}
              </Button>
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!isAdmin || !mayInvite}
            onClick={async () => {
              const result = await invite({
                ...target,
                input: { ...target.input, role: "member" },
              });
              if (result._tag === "Success") setCode(result.value.code);
            }}
          >
            <PlusIcon />
            生成邀请码
          </Button>
          <Button variant="ghost-muted" onClick={props.onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AccountMenu({ environmentId }: { environmentId: EnvironmentId }) {
  const { current } = useTelescopeWorkspaces();
  const workspaces =
    useEnvironmentQuery(telescope.list({ environmentId, input: {} })).data?.workspaces ?? [];
  const self =
    useEnvironmentQuery(
      current === null
        ? null
        : telescope.get({ environmentId, input: { workspaceId: current.id } }),
    ).data?.self ?? null;
  const setCurrent = useAtomSet(telescope.storedWorkspaceIdAtom);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const name = self?.displayName ?? "未加入工作区";
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
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-medium">{name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{current?.name ?? "新建或加入一个工作区"}</span>
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
                  if (picked) setCurrent(picked.id);
                }}
              >
                {workspaces.map((workspace) => (
                  <MenuRadioItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                    <MenuItemDetail>{WORKSPACE_KIND_LABEL[workspace.kind]}</MenuItemDetail>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
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

/** Telescope's bottom-left account row; Code keeps its own footer. */
export function TelescopeAccountFooter() {
  const { environmentId } = useTelescopeWorkspaces();
  const navigate = useNavigate();
  if (environmentId === null) return null;
  return (
    <div className="flex shrink-0 items-center justify-between gap-1 border-t px-2 py-2">
      <AccountMenu environmentId={environmentId} />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="设置"
              size="icon-sm"
              variant="ghost-muted"
              onClick={() => void navigate({ to: "/settings" })}
            />
          }
        >
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">设置</TooltipPopup>
      </Tooltip>
    </div>
  );
}
