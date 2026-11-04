// PROTOTYPE, wipe me. Create a workspace, or join one from an invite link or code.
import { useId, useState, type ReactNode } from "react";

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
import { WORKSPACE_KIND, type LighthouseViewer, type LighthouseWorkspace } from "./lighthouseData";
import {
  acceptInvite,
  createWorkspace,
  findInvite,
  isMemberOf,
  setWorkspace,
  type WorkspaceInvite,
} from "./workspaceStore";

const KIND_HINT: Record<LighthouseWorkspace["kind"], string> = {
  enterprise: "你是公司管理员。工作区自带主代理；人事、财务等部门代理以后由管理员添加。",
  personal: "只有你自己的 agents，没有公司 agents，也没有「可被主代理调度」。",
};

function DialogShell({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  canSubmit,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  canSubmit: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
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

export function CreateWorkspaceDialog({
  viewer,
  onClose,
  onDone,
}: {
  viewer: LighthouseViewer;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LighthouseWorkspace["kind"]>("enterprise");
  return (
    <DialogShell
      title="新建工作区"
      description="工作区分企业和个人。建好后马上切换过去。"
      onClose={onClose}
      submitLabel="新建"
      canSubmit={name.trim().length > 0}
      onSubmit={() => {
        createWorkspace(name.trim(), kind, viewer);
        onDone();
      }}
    >
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-name`}>
        名字
        <Input
          nativeInput
          id={`${id}-name`}
          autoFocus
          placeholder="例如 Gripper Lab"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </Label>
      <div className="flex flex-col gap-2">
        <ToggleGroup
          aria-label="工作区类型"
          variant="segmented"
          value={[kind]}
          onValueChange={(next) => {
            const v = next[0];
            if (v === "enterprise" || v === "personal") setKind(v);
          }}
        >
          <Toggle value="enterprise">企业</Toggle>
          <Toggle value="personal">个人</Toggle>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
      </div>
    </DialogShell>
  );
}

function InvitePreview({ invite }: { invite: WorkspaceInvite }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
      <span className="flex items-center gap-2 font-medium">
        {invite.workspace.name}
        <Badge variant="outline" size="sm">
          {WORKSPACE_KIND[invite.workspace.kind]}
        </Badge>
      </span>
      <span className="text-muted-foreground">
        {invite.from} 邀请你，以「{invite.role}」身份加入。
      </span>
    </div>
  );
}

export function JoinWorkspaceDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const invite = findInvite(text);
  const member = invite ? isMemberOf(invite.workspace.id) : false;
  return (
    <DialogShell
      title="加入工作区"
      description="粘贴别人发给你的邀请链接或邀请码。"
      onClose={onClose}
      submitLabel={member ? "切换过去" : "加入"}
      canSubmit={invite !== undefined}
      onSubmit={() => {
        if (!invite) return;
        if (member) setWorkspace(invite.workspace.id);
        else acceptInvite(invite);
        onDone();
      }}
    >
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-code`}>
        邀请链接或邀请码
        <Input
          nativeInput
          id={`${id}-code`}
          autoFocus
          placeholder="codi.app/join/NOVA-3K8D"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </Label>
      {invite ? (
        <>
          <InvitePreview invite={invite} />
          {member ? <p className="text-xs text-muted-foreground">你已经在这个工作区里。</p> : null}
        </>
      ) : text.trim() ? (
        <p className="text-xs text-muted-foreground">
          找不到这个邀请。它可能已过期，或者已被撤回。
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          原型里可以试 <span className="font-mono">NOVA-3K8D</span> 或{" "}
          <span className="font-mono">GRIP-7Q2K</span>。
        </p>
      )}
    </DialogShell>
  );
}
