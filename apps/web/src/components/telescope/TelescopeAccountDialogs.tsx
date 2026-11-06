import { useAtomValue } from "@effect/atom-react";
import {
  failureText,
  isEnvironmentOwner,
  WORKSPACE_ERROR_TEXT,
  type WorkspaceErrorText,
} from "@t3tools/client-runtime/telescope/workspaces";
import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { telescope } from "./telescopeState";

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

const JOIN_ERROR_TEXT: WorkspaceErrorText = {
  not_found: "邀请码无效。",
  forbidden: "你已被移出该工作区。",
  expired: "邀请码已过期。",
  conflict: "邀请码已被使用，或你已是该工作区成员。",
  storage: WORKSPACE_ERROR_TEXT.storage,
  invalid: "邀请码格式无效。",
};

const expiryFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <span className="min-w-0 flex-1">{text}</span>
      {onRetry ? (
        <Button size="xs" variant="outline" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

function FormDialog({
  title,
  description,
  submitLabel,
  canSubmit,
  error,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  canSubmit: boolean;
  error: string | null;
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
            <div className="flex flex-col gap-4">
              {children}
              {error === null ? null : <ErrorNote text={error} />}
            </div>
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

export function CreateWorkspaceDialog(props: {
  environmentId: EnvironmentId;
  defaultName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(props.defaultName);
  const [kind, setKind] = useState<Telescope.Workspace["kind"]>("enterprise");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAtomCommand(telescope.create, "新建工作区");
  return (
    <FormDialog
      title="新建工作区"
      description="工作区分企业和个人。建好后马上切换过去。"
      submitLabel="新建"
      canSubmit={!busy && name.trim() !== "" && displayName.trim() !== ""}
      error={error}
      onClose={props.onClose}
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        const result = await create({
          environmentId: props.environmentId,
          input: { kind, name: name.trim(), displayName: displayName.trim() },
        });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
        else setError(failureText(result));
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

export function JoinWorkspaceDialog(props: {
  environmentId: EnvironmentId;
  defaultName: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(props.defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = useAtomCommand(telescope.accept, "加入工作区");
  return (
    <FormDialog
      title="加入工作区"
      description="填入管理员发给你的邀请码。加入后马上切换过去。"
      submitLabel="加入"
      canSubmit={!busy && code.trim() !== "" && displayName.trim() !== ""}
      error={error}
      onClose={props.onClose}
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        const result = await accept({
          environmentId: props.environmentId,
          input: { code: code.trim(), displayName: displayName.trim() },
        });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
        else setError(failureText(result, JOIN_ERROR_TEXT));
      }}
    >
      <TextField label="邀请码" autoFocus value={code} onChange={setCode} />
      <TextField label="你在工作区里的名字" value={displayName} onChange={setDisplayName} />
    </FormDialog>
  );
}

export function MembersDialog(props: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member | null;
  onClose: () => void;
}) {
  const target = { environmentId: props.environmentId, input: { workspaceId: props.workspace.id } };
  const query = useEnvironmentQuery(telescope.members(target));
  const mayInvite = useAtomValue(telescope.invite.permissionAtom(props.environmentId));
  const mayRevoke = useAtomValue(telescope.revoke.permissionAtom(props.environmentId));
  const isAdmin = props.self?.role === "admin";
  const invite = useAtomCommand(telescope.invite, "生成邀请码");
  const revoke = useAtomCommand(telescope.revoke, "移除成员");
  const [invitation, setInvitation] = useState<Telescope.Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const active = (query.data?.members ?? []).filter((member) => member.revokedAt === undefined);
  const remove = async (member: Telescope.Member) => {
    const confirmed = await (requestConfirmDialog(
      `移除 ${member.displayName}？移除后对方不能再进入这个工作区，目前无法恢复。`,
      { variant: "destructive" },
    ) ?? Promise.resolve(false));
    if (!confirmed) return;
    setError(null);
    const result = await revoke({
      ...target,
      input: { ...target.input, subjectId: member.subjectId },
    });
    setError(failureText(result));
  };
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
          {query.data !== null ? (
            <ul className="flex flex-col divide-y">
              {active.map((member) => (
                <li key={member.subjectId} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{member.displayName}</span>
                  <Badge variant="outline" size="sm">
                    {WORKSPACE_ROLE_LABEL[member.role]}
                  </Badge>
                  {member.subjectId === props.self?.subjectId ||
                  isEnvironmentOwner(member) ? null : (
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      disabled={!isAdmin || !mayRevoke}
                      onClick={() => void remove(member)}
                    >
                      移除
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : query.error !== null ? (
            <ErrorNote text="成员加载失败。" onRetry={query.refresh} />
          ) : (
            <p className="text-sm text-muted-foreground">正在加载成员…</p>
          )}
          {invitation === null ? null : (
            <div className="mt-4 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input nativeInput readOnly aria-label="邀请码" value={invitation.code} />
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(invitation.code, undefined)}
                >
                  {isCopied ? "已复制" : "复制"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                有效期至 {expiryFormatter.format(new Date(invitation.expiresAt))}，只能使用一次。
              </p>
            </div>
          )}
          {error === null ? null : (
            <div className="mt-4">
              <ErrorNote text={error} />
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!isAdmin || !mayInvite}
            onClick={async () => {
              setError(null);
              const result = await invite({
                ...target,
                input: { ...target.input, role: "member" },
              });
              if (result._tag === "Success") setInvitation(result.value);
              else setError(failureText(result));
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
