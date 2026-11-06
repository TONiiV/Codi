// PROTOTYPE, wipe me. Create a workspace. Joining one happens only by accepting an invite.
import { useId, useState, type ReactNode } from "react";

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
import type { LighthouseViewer, LighthouseWorkspace } from "./lighthouseData";
import { createWorkspace } from "./workspaceStore";

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
