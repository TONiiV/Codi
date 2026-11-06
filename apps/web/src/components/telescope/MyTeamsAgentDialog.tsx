import {
  cappedPowers,
  ownerCanMergePRs,
  selectableExposures,
} from "@t3tools/client-runtime/telescope/agents";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { EXPOSURE_LABEL, KIND_LABEL, POWERS, telescopeAgents } from "./myTeamsShared";

const isExposure = (value: unknown): value is Telescope.AgentExposure =>
  typeof value === "string" && value in EXPOSURE_LABEL;

function mergeCapHint(agent: Telescope.Agent) {
  return agent.kind === "chief_agent"
    ? "你不是这个项目的负责人，合并 PR 只有负责人的 agent 能做"
    : "你不是管理员，这个 agent 不能合并 PR";
}

function SettingsDialog(props: {
  title: string;
  description: string;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">{props.children}</div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost-muted" onClick={props.onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!props.canSubmit || props.busy}>
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Settings for one agent: the caller's own, or a company agent when the caller is an admin. */
export function AgentSettingsDialog({
  environmentId,
  workspace,
  self,
  agent,
  bindings,
  onClose,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member;
  agent: Telescope.Agent;
  bindings: ReadonlyArray<Telescope.ProjectBinding>;
  onClose: () => void;
}) {
  const id = useId();
  const company = agent.ownerSubjectId === null;
  const update = useAtomCommand(
    company ? telescopeAgents.updateCompany : telescopeAgents.update,
    "保存 agent 设定",
  );
  const [name, setName] = useState(agent.name);
  const [exposure, setExposure] = useState(agent.exposure);
  const canMerge = company || ownerCanMergePRs(self, agent, bindings);
  const shownPowers = cappedPowers(agent.standingPowers, canMerge);
  const [powers, setPowers] = useState(shownPowers);
  const [syncWithBoard, setSyncWithBoard] = useState(agent.syncWithBoard);
  const [dispatchMode, setDispatchMode] = useState(agent.dispatchMode);
  const [busy, setBusy] = useState(false);
  const selectable = selectableExposures(agent.exposure, workspace.kind);
  const enterprise = workspace.kind === "enterprise";

  const save = async () => {
    const changed = POWERS.some(({ id: power }) => powers[power] !== shownPowers[power]);
    setBusy(true);
    const result = await update({
      environmentId,
      input: {
        workspaceId: workspace.id,
        agentId: agent.id,
        ...(name.trim() === agent.name ? {} : { name: name.trim() }),
        ...(company || exposure === agent.exposure ? {} : { exposure }),
        // Untouched powers are not resent, so a stored merge right above the cap survives.
        ...(changed ? { standingPowers: powers } : {}),
        ...(syncWithBoard === agent.syncWithBoard ? {} : { syncWithBoard }),
        ...(dispatchMode === agent.dispatchMode ? {} : { dispatchMode }),
      },
    });
    setBusy(false);
    if (AsyncResult.isSuccess(result)) onClose();
  };

  return (
    <SettingsDialog
      title={company ? "设定公司 agent" : "改名和设定"}
      description={`${KIND_LABEL[agent.kind]}。${company ? "公司 agents 归公司，只有管理员能配置。" : "只有你能改这个 agent。"}`}
      submitLabel="保存"
      canSubmit={name.trim().length > 0}
      busy={busy}
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-name`}>
        名字
        <Input
          nativeInput
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Label>
      {company ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">暴露级别</legend>
          <ToggleGroup
            aria-label="暴露级别"
            variant="segmented"
            value={[exposure]}
            onValueChange={(next) => {
              if (isExposure(next[0])) setExposure(next[0]);
            }}
          >
            {(Object.keys(EXPOSURE_LABEL) as Array<Telescope.AgentExposure>).map((level) => (
              <Toggle key={level} value={level} disabled={!selectable.has(level)}>
                {EXPOSURE_LABEL[level]}
              </Toggle>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            一次只能往上开一级，保存后才能再开下一级；随时可以调低。
            {enterprise ? null : "个人工作区没有主代理，不能设为可调度。"}
          </p>
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">不用问你就能做</legend>
        {POWERS.map((power) => {
          const capped = power.id === "mergePRs" && !canMerge;
          return (
            <label
              key={power.id}
              className="flex cursor-pointer items-start gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-64"
            >
              <Checkbox
                disabled={capped}
                checked={!capped && powers[power.id]}
                onCheckedChange={(on) => setPowers({ ...powers, [power.id]: on === true })}
              />
              <span className="flex flex-col">
                <span>{power.label}</span>
                <span className="text-xs text-muted-foreground">
                  {capped ? mergeCapHint(agent) : power.hint}
                </span>
              </span>
            </label>
          );
        })}
        {company ? null : (
          <p className="text-xs text-muted-foreground">
            上限是你的角色。没勾的事它先问你；每次动手都用提问人的权限执行并记审计。
          </p>
        )}
      </fieldset>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
        <span className="flex flex-col">
          <span>和任务板同步</span>
          <span className="text-xs text-muted-foreground">
            开工前在板上领租约，完工后写回结果、产物和决定
          </span>
        </span>
        <Switch checked={syncWithBoard} onCheckedChange={(on) => setSyncWithBoard(on)} />
      </label>
      {enterprise ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <span className="flex flex-col">
            <span>被派活时</span>
            <span className="text-xs text-muted-foreground">主代理派来的活怎么处理</span>
          </span>
          <ToggleGroup
            aria-label="被派活时"
            variant="segmented"
            value={[dispatchMode]}
            onValueChange={(next) => {
              if (next[0] === "start" || next[0] === "inbox") setDispatchMode(next[0]);
            }}
          >
            <Toggle value="start">直接开工</Toggle>
            <Toggle value="inbox">先进收件箱</Toggle>
          </ToggleGroup>
        </div>
      ) : null}
    </SettingsDialog>
  );
}

export function CreateCustomAgentDialog({
  environmentId,
  workspaceId,
  onClose,
}: {
  environmentId: EnvironmentId;
  workspaceId: Telescope.WorkspaceId;
  onClose: () => void;
}) {
  const id = useId();
  const create = useAtomCommand(telescopeAgents.createCustom, "新建自定义 agent");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await create({ environmentId, input: { workspaceId, name: name.trim() } });
    setBusy(false);
    if (AsyncResult.isSuccess(result)) onClose();
  };
  return (
    <SettingsDialog
      title="新建自定义 agent"
      description="新 agent 只属于你，不挂在某个项目下。建好后默认不暴露，可以在设定里逐级打开。"
      submitLabel="新建"
      canSubmit={name.trim().length > 0}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-name`}>
        名字
        <Input
          nativeInput
          id={`${id}-name`}
          value={name}
          placeholder="比如：周报助手"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Label>
    </SettingsDialog>
  );
}
