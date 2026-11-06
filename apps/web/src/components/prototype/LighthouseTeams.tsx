// PROTOTYPE, wipe me. My Teams: the viewer's own agents (个人助理, their Chief Agents and custom
// agents), the company's agents in an enterprise workspace, and the skills both use. Company
// agents and personal agents are separate sets; only a company admin configures company agents.
import { useNavigate } from "@tanstack/react-router";
import { LockIcon, MessageSquareIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import { AGENT_STATES, Bloub, type AgentState } from "./LighthouseBloub";
import { ChannelBadges, ChannelSettings } from "./LighthouseChannels";
import {
  saveChannels,
  useChannels,
  useWechatHolder,
  type ChannelOwner,
  type ChannelSet,
} from "./channelStore";
import {
  addChiefAgent,
  addCustomAgent,
  saveCompanyAgent,
  saveCos,
  setTeamsTab,
  useAllBots,
  useCosSetup,
  useRegistryVersion,
  useTeamsTab,
  useViewer,
  type CosPower,
  type CosSetup,
} from "./lighthouseActions";
import {
  PROJECT_COS,
  PROJECTS,
  chiefName,
  chiefProjects,
  companyAgentsIn,
  customAgent,
  customAgentsIn,
  hasChief,
  isEnterprise,
  isWorkspaceAdmin,
  projectsIn,
  roleIn,
  type CompanyAgent,
  type LighthouseViewer,
} from "./lighthouseData";
import { Badge } from "../ui/badge";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

const POWERS: ReadonlyArray<{ id: CosPower; label: string; hint: string; lead?: true }> = [
  { id: "ticket", label: "开工单", hint: "把任务拆成工单，挂到任务下面" },
  { id: "worker", label: "派 Worker", hint: "在项目的机器上起 Worker 接工单" },
  { id: "answer", label: "回答别人", hint: "用提问人自己的权限回答项目里的问题" },
  { id: "merge", label: "合并 PR", hint: "CI 绿、评审过就合并", lead: true },
];

const HARNESSES = [
  "Codi 滚动线程 / Sonnet",
  "Codi 滚动线程 / Opus",
  "Claude Code / Sonnet",
  "Codex / gpt-5",
];

// Every Chief of Staff and Chief Agent runs here; Workers run where the code is.
export const CLOUD = "公司云服务器 · lighthouse-01";

export function freshSetup(name: string): CosSetup {
  return {
    name,
    harness: HARNESSES[0]!,
    powers: ["ticket", "worker", "answer"],
    report: "daily",
    board: true,
    dispatchable: true,
    onDispatch: "inbox",
  };
}

export function powerSummary(setup: CosSetup) {
  return POWERS.filter((p) => setup.powers.includes(p.id))
    .map((p) => p.label)
    .join("、");
}

function Toggled({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="flex flex-col">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={(on) => onChange(Boolean(on))} />
    </label>
  );
}

/**
 * Settings for one of the viewer's own agents. `role` is the viewer's role in the project and
 * caps the standing powers; null means the agent is their Chief of Staff.
 */
export function AgentDialog({
  title,
  subtitle,
  role,
  enterprise,
  capReason = "你在这个项目是成员，合并 PR 只有负责人的 agent 能做",
  initial,
  onSave,
  onClose,
  children,
  channels,
}: {
  title: string;
  subtitle: string;
  role: "lead" | "member" | null;
  /** Only an enterprise workspace has 主代理, so only there can it dispatch work. */
  enterprise: boolean;
  capReason?: string;
  initial: CosSetup;
  onSave: (setup: CosSetup) => void;
  onClose: () => void;
  children?: ReactNode;
  /** The agent's channels; saved together with the rest of the dialog. */
  channels?: { owner: ChannelOwner; initial: ChannelSet; wechatHolder: string | null };
}) {
  const id = useId();
  const [setup, setSetup] = useState(initial);
  const [channelDraft, setChannelDraft] = useState(channels?.initial ?? {});
  const set = <K extends keyof CosSetup>(key: K, value: CosSetup[K]) =>
    setSetup({ ...setup, [key]: value });
  const toggle = (power: CosPower, on: boolean) =>
    set("powers", on ? [...setup.powers, power] : setup.powers.filter((p) => p !== power));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (channels) saveChannels(channels.owner, channelDraft);
            onSave({ ...setup, name: setup.name.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {children}
              <div className="flex items-center gap-3">
                <BotAvatar seed={setup.name} size="lg" />
                <Label className="flex flex-1 flex-col items-stretch" htmlFor={`${id}-name`}>
                  名字
                  <Input
                    nativeInput
                    id={`${id}-name`}
                    value={setup.name}
                    onChange={(e) => set("name", e.currentTarget.value)}
                  />
                </Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Label className="flex flex-col items-stretch">
                  Harness / 模型
                  <Select value={setup.harness} onValueChange={(v) => v && set("harness", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {HARNESSES.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
                <Label className="flex flex-col items-stretch">
                  向你汇报
                  <Select
                    value={setup.report}
                    items={{ daily: "每天早上", weekly: "每周一" }}
                    onValueChange={(v) => (v === "daily" || v === "weekly") && set("report", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="daily">每天早上</SelectItem>
                      <SelectItem value="weekly">每周一</SelectItem>
                    </SelectPopup>
                  </Select>
                </Label>
                <div className="col-span-2 flex flex-col gap-1 text-sm">
                  <span className="font-medium">运行在</span>
                  <span className="text-muted-foreground">
                    {CLOUD}。身份固定，以后可以换机器跑。
                  </span>
                </div>
              </div>
              {role ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">不用问你就能做</legend>
                  {POWERS.map((p) => {
                    const capped = p.lead === true && role !== "lead";
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-start gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-64"
                      >
                        <Checkbox
                          disabled={capped}
                          checked={!capped && setup.powers.includes(p.id)}
                          onCheckedChange={(on) => toggle(p.id, on)}
                        />
                        <span className="flex flex-col">
                          <span>{p.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {capped ? capReason : p.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    上限是你的角色（{role === "lead" ? "负责人" : "成员"}
                    ）。没勾的事它先问你；每次动手都用提问人的权限执行并记审计。
                  </p>
                </fieldset>
              ) : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">
                  {enterprise ? "任务板和主代理" : "任务板"}
                </legend>
                <Toggled
                  label="和任务板同步"
                  hint="开工前在板上领租约，完工后写回结果、产物和决定"
                  checked={setup.board}
                  onChange={(on) => set("board", on)}
                />
                {enterprise ? (
                  <Toggled
                    label="可被主代理调度"
                    hint="关掉后只有你能给它派活"
                    checked={setup.dispatchable}
                    onChange={(on) => set("dispatchable", on)}
                  />
                ) : null}
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
                    !enterprise && "hidden",
                  )}
                >
                  <span className="flex flex-col">
                    <span>被派活时</span>
                    <span className="text-xs text-muted-foreground">
                      {setup.dispatchable ? "主代理派来的活怎么处理" : "已关闭调度"}
                    </span>
                  </span>
                  <ToggleGroup
                    aria-label="被派活时"
                    variant="segmented"
                    disabled={!setup.dispatchable}
                    value={[setup.onDispatch]}
                    onValueChange={(next) => {
                      const v = next[0];
                      if (v === "start" || v === "inbox") set("onDispatch", v);
                    }}
                  >
                    <Toggle value="start">直接开工</Toggle>
                    <Toggle value="inbox">先进收件箱</Toggle>
                  </ToggleGroup>
                </div>
              </fieldset>
              {channels ? (
                <ChannelSettings
                  owner={channels.owner}
                  value={channelDraft}
                  onChange={setChannelDraft}
                  wechatHolder={channels.wechatHolder}
                />
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost-muted" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={setup.name.trim().length === 0}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function dispatchLine(setup: CosSetup) {
  if (!setup.dispatchable) return "不接主代理派活";
  return setup.onDispatch === "start" ? "主代理可派活 · 直接开工" : "主代理可派活 · 先进收件箱";
}

/** What kind of personal agent a chat id is, and how to describe it in a row. */
function agentKind(viewer: LighthouseViewer, id: string | null) {
  if (id === null)
    return { kind: "assistant" as const, line: "个人助理 · 管你在所有项目里的 Chief Agent" };
  const custom = customAgent(id);
  if (custom) {
    return {
      kind: "custom" as const,
      line: `自定义 agent · skills：${custom.skills.map(skillName).join("、") || "无"}`,
    };
  }
  const role = roleIn(viewer, id);
  return {
    kind: "chief" as const,
    line: `${PROJECTS[id]?.name} Chief Agent · 你是${role === "lead" ? "负责人" : "成员"}`,
  };
}

/** Custom agents have no project, so their cap is the viewer's company role. */
const customRole = (viewer: LighthouseViewer) => (viewer === "admin" ? "lead" : "member");
const CUSTOM_CAP = "你不是管理员，自定义 agent 不能合并 PR";

const personalOwner = (
  viewer: LighthouseViewer,
  workspace: string,
  project: string | null,
): ChannelOwner => ({ kind: "personal", viewer, workspace, agent: project ?? "cos" });

function AgentRow({
  viewer,
  workspace,
  project,
  enterprise,
  onEdit,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  project: string | null;
  enterprise: boolean;
  onEdit: () => void;
}) {
  const setup = useCosSetup(viewer, project);
  const channels = useChannels(personalOwner(viewer, workspace, project));
  const workers = useAllBots().filter((b) => b.kind === "worker" && b.project === project);
  const { line } = agentKind(viewer, project);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <BotAvatar seed={setup.name} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{setup.name}</span>
          <span className="text-xs text-muted-foreground">{line}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant="outline">{setup.harness}</Badge>
          {project ? (
            <Badge variant="outline">直接做：{powerSummary(setup) || "都先问"}</Badge>
          ) : null}
          <Badge variant={setup.board ? "info" : "outline"}>
            {setup.board ? "任务板同步" : "不同步任务板"}
          </Badge>
          {enterprise ? <Badge variant="outline">{dispatchLine(setup)}</Badge> : null}
          <ChannelBadges value={channels} />
        </div>
        {workers.length > 0 ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Worker：{workers.map((w) => `${w.id}（${w.where}）`).join("、")}
          </div>
        ) : null}
      </div>
      <Button size="xs" variant="ghost-muted" onClick={onEdit}>
        <Settings2Icon /> 改名和设定
      </Button>
    </li>
  );
}

function EditAgent({
  viewer,
  workspace,
  project,
  enterprise,
  onClose,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  project: string | null;
  enterprise: boolean;
  onClose: () => void;
}) {
  const setup = useCosSetup(viewer, project);
  const { kind } = agentKind(viewer, project);
  const owner = personalOwner(viewer, workspace, project);
  const channels = useChannels(owner);
  const holder = useWechatHolder(viewer);
  const cosName = useViewer(viewer).cos.name;
  const holderName =
    holder === null || holder === owner.agent
      ? null
      : holder === "cos"
        ? cosName
        : chiefName(viewer, holder);
  return (
    <AgentDialog
      title={
        kind === "assistant"
          ? "设定你的个人助理"
          : kind === "custom"
            ? "设定你的自定义 agent"
            : "设定你的 Chief Agent"
      }
      subtitle={
        kind === "assistant"
          ? "个人助理（Chief of Staff），管你在所有项目里的 Chief Agent。"
          : kind === "custom"
            ? "只属于你，不挂在某个项目下。"
            : `${PROJECTS[project ?? ""]?.name}：项目里每人有自己的 Chief Agent，大家靠同一块任务板对齐。改的只是你的这位。`
      }
      role={
        project === null ? null : kind === "custom" ? customRole(viewer) : roleIn(viewer, project)
      }
      {...(kind === "custom" ? { capReason: CUSTOM_CAP } : {})}
      enterprise={enterprise}
      initial={setup}
      channels={{ owner, initial: channels, wechatHolder: holderName }}
      onClose={onClose}
      onSave={(next) => {
        saveCos(viewer, project, next);
        onClose();
      }}
    />
  );
}

const agentsOf = (
  viewer: LighthouseViewer,
  workspace: string,
  cosName: string,
  _version: number,
) => [
  { key: "cos", name: cosName },
  ...chiefProjects(workspace, viewer).map((id) => ({ key: id, name: chiefName(viewer, id) })),
  ...customAgentsIn(workspace, viewer).map((a) => ({ key: a.id, name: chiefName(viewer, a.id) })),
];

function AvatarShowcase({ names }: { names: ReadonlyArray<string> }) {
  const [state, setState] = useState<AgentState>("idle");
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          头像照搬 bloub，形状和颜色由名字决定。点一个状态看动画。
        </span>
        <div className="flex flex-wrap gap-1">
          {AGENT_STATES.map((s) => (
            <Button
              key={s.id}
              size="xs"
              variant={state === s.id ? "secondary" : "ghost-muted"}
              onClick={() => setState(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {names.map((n) => (
          <figure key={n} className="flex flex-col items-center gap-1">
            <Bloub seed={n} state={state} roomy followPointer lively className="w-full" />
            <figcaption className="truncate text-xs font-medium">{n}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** My agents in the order the user expects: 个人助理, project Chief Agents, then custom ones. */
const myAgentIds = (workspace: string, viewer: LighthouseViewer, _version: number) => ({
  chiefs: chiefProjects(workspace, viewer),
  custom: customAgentsIn(workspace, viewer).map((a) => a.id),
  addable: projectsIn(workspace, viewer).open.filter((id) => !hasChief(viewer, id)),
});

/**
 * Adds one of the viewer's own agents: their Chief Agent in a project they are in that has
 * none yet, or a custom agent with its own skills and powers.
 */
export function AddAgentDialog({
  viewer,
  workspace,
  onClose,
  onAdded,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  onClose: () => void;
  onAdded: (chat: string) => void;
}) {
  const enterprise = isEnterprise(workspace);
  const { addable } = myAgentIds(workspace, viewer, useRegistryVersion());
  const [kind, setKind] = useState<"chief" | "custom">(addable.length > 0 ? "chief" : "custom");
  const [project, setProject] = useState(addable[0] ?? "");
  const [skills, setSkills] = useState<ReadonlyArray<string>>([]);
  const skillChoices = [...(enterprise ? COMPANY_SKILLS : []), ...MY_SKILLS];
  const initial =
    kind === "chief"
      ? freshSetup(PROJECT_COS[project]?.name ?? "Chief Agent")
      : { ...freshSetup("新 agent"), powers: ["answer" as const] };
  return (
    <AgentDialog
      key={kind + project}
      title="添加 agent"
      subtitle="新 agent 只属于你，出现在对话列表的「我的 Agents」里。"
      role={kind === "chief" ? roleIn(viewer, project) : customRole(viewer)}
      {...(kind === "custom" ? { capReason: CUSTOM_CAP } : {})}
      enterprise={enterprise}
      initial={initial}
      onClose={onClose}
      onSave={(setup) => {
        if (kind === "chief") {
          if (!project) return;
          addChiefAgent(viewer, project, setup);
          onAdded(project);
        } else {
          onAdded(addCustomAgent(viewer, workspace, skills, setup));
        }
      }}
    >
      <div className="flex flex-col gap-3 rounded-md border p-3">
        <ToggleGroup
          aria-label="agent 类型"
          variant="segmented"
          value={[kind]}
          onValueChange={(next) => {
            const v = next[0];
            if (v === "chief" || v === "custom") setKind(v);
          }}
        >
          <Toggle value="chief" disabled={addable.length === 0}>
            项目 Chief Agent
          </Toggle>
          <Toggle value="custom">自定义 agent</Toggle>
        </ToggleGroup>
        {kind === "chief" ? (
          <Label className="flex flex-col items-stretch">
            项目
            <Select
              value={project}
              items={Object.fromEntries(addable.map((id) => [id, PROJECTS[id]?.name ?? id]))}
              onValueChange={(v) => v && setProject(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {addable.map((id) => (
                  <SelectItem key={id} value={id}>
                    {PROJECTS[id]?.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="text-xs font-normal text-muted-foreground">
              只列你参与、但还没有你的 Chief Agent 的项目。
            </span>
          </Label>
        ) : (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">用哪些 skills</legend>
            {skillChoices.map((sk) => (
              <label key={sk.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={skills.includes(sk.id)}
                  onCheckedChange={(on) =>
                    setSkills(on ? [...skills, sk.id] : skills.filter((x) => x !== sk.id))
                  }
                />
                {sk.name}
                <span className="font-mono text-xs text-muted-foreground">v{sk.version}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </AgentDialog>
  );
}

function MyAgents({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const navigate = useNavigate();
  const version = useRegistryVersion();
  const me = useViewer(viewer);
  const enterprise = isEnterprise(workspace);
  const { chiefs, custom } = myAgentIds(workspace, viewer, version);
  const names = agentsOf(viewer, workspace, me.cos.name, version).map((a) => a.name);
  // undefined: closed; null: 个人助理; a string: that project's Chief Agent or a custom agent.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          这些 agent 归你：最上面是个人助理，然后是你在项目里的 Chief Agent，以及你自己配的自定义
          agent。它们都跑在 {CLOUD}，只听你的，彼此靠任务板对齐。
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon /> 添加 agent
        </Button>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        <AgentRow
          viewer={viewer}
          workspace={workspace}
          project={null}
          enterprise={enterprise}
          onEdit={() => setEditing(null)}
        />
        {[...chiefs, ...custom].map((id) => (
          <AgentRow
            key={id}
            viewer={viewer}
            workspace={workspace}
            project={id}
            enterprise={enterprise}
            onEdit={() => setEditing(id)}
          />
        ))}
      </ul>
      <AvatarShowcase names={names.slice(0, 6)} />
      {editing !== undefined ? (
        <EditAgent
          viewer={viewer}
          workspace={workspace}
          project={editing}
          enterprise={enterprise}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {adding ? (
        <AddAgentDialog
          viewer={viewer}
          workspace={workspace}
          onClose={() => setAdding(false)}
          onAdded={(chat) => {
            setAdding(false);
            void navigate({
              to: "/prototype/lighthouse",
              search: { as: viewer, chat, view: "teams" },
            });
          }}
        />
      ) : null}
    </section>
  );
}

function CompanyAgentDialog({
  agent,
  workspace,
  onClose,
}: {
  agent: CompanyAgent;
  workspace: string;
  onClose: () => void;
}) {
  const id = useId();
  const channelOwner: ChannelOwner = { kind: "company", agent: agent.id, workspace };
  const saved = useChannels(channelOwner);
  const [channels, setChannels] = useState(saved);
  const [name, setName] = useState(agent.name);
  const [owner, setOwner] = useState(agent.owner);
  const [can, setCan] = useState(agent.can.join("\n"));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            saveChannels(channelOwner, channels);
            saveCompanyAgent(agent.id, {
              name: name.trim(),
              owner: owner.trim(),
              can: can
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            });
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>设定公司 agent</DialogTitle>
            <DialogDescription>
              {agent.dept}。只有公司管理员能改；改动对全公司生效，并记审计。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-name`}>
                名字
                <Input
                  nativeInput
                  id={`${id}-name`}
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
              </Label>
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-owner`}>
                负责人
                <Input
                  nativeInput
                  id={`${id}-owner`}
                  value={owner}
                  onChange={(e) => setOwner(e.currentTarget.value)}
                />
              </Label>
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-can`}>
                能做什么（一行一条）
                <Textarea
                  id={`${id}-can`}
                  value={can}
                  onChange={(e) => setCan(e.currentTarget.value)}
                />
              </Label>
              <ChannelSettings
                owner={channelOwner}
                value={channels}
                onChange={setChannels}
                wechatHolder={null}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost-muted" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={name.trim().length === 0}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

const companyAt = (workspace: string, _version: number) => companyAgentsIn(workspace);

function CompanyChannels({ agent, workspace }: { agent: string; workspace: string }) {
  const channels = useChannels({ kind: "company", agent, workspace });
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      信道：Codi
      <ChannelBadges value={channels} withHandle />
    </div>
  );
}

function CompanyAgents({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const navigate = useNavigate();
  const agents = companyAt(workspace, useRegistryVersion());
  const admin = isWorkspaceAdmin(viewer, workspace);
  const [editing, setEditing] = useState<CompanyAgent | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <LockIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          公司 agents 和你的 agents 是两套。公司 agents
          归公司，按你的权限回答。主代理只有在你打开「可被主代理调度」时，才能给你的 agents 派活。
          {admin ? " 你是公司管理员，可以设定它们。" : " 只有公司管理员能配置它们。"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((a) => (
          <article key={a.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <BotAvatar seed={a.name} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.name}</span>
                  <Badge variant="outline">{a.dept}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  归 {a.owner} · 运行在 {CLOUD}
                </div>
              </div>
            </div>
            <ul className="flex list-disc flex-col gap-0.5 ps-5 text-sm">
              {a.can.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <CompanyChannels agent={a.id} workspace={workspace} />
            <div className="mt-auto flex items-center justify-end gap-2">
              {admin ? (
                <Button size="xs" variant="ghost-muted" onClick={() => setEditing(a)}>
                  <Settings2Icon /> 设定
                </Button>
              ) : (
                <span className="me-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <LockIcon className="size-3" /> 只有公司管理员能配置
                </span>
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void navigate({
                    to: "/prototype/lighthouse",
                    search: { as: viewer, chat: a.id, view: "chats" },
                  })
                }
              >
                <MessageSquareIcon /> 在对话里找它
              </Button>
            </div>
          </article>
        ))}
      </div>
      {editing ? (
        <CompanyAgentDialog
          agent={editing}
          workspace={workspace}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

interface Skill {
  id: string;
  name: string;
  version: string;
  owner: string;
  summary: string;
}

function skillName(id: string): string {
  return [...COMPANY_SKILLS, ...MY_SKILLS].find((s) => s.id === id)?.name ?? id;
}

const COMPANY_SKILLS: ReadonlyArray<Skill> = [
  {
    id: "pr-review",
    name: "PR 评审清单",
    version: "1.4.0",
    owner: "工程部",
    summary: "合并前查测试、迁移、权限和文档。",
  },
  {
    id: "release",
    name: "发版流程",
    version: "0.9.0",
    owner: "运维",
    summary: "打 tag、写更新日志、通知相关人。",
  },
  {
    id: "weekly",
    name: "周报格式",
    version: "2.0.1",
    owner: "行政部",
    summary: "从任务板汇总本周完成和卡住的事。",
  },
  {
    id: "contract",
    name: "合同条款比对",
    version: "1.1.0",
    owner: "法务部",
    summary: "和公司模板逐条比，标出偏离。",
  },
];

const MY_SKILLS: ReadonlyArray<Omit<Skill, "owner">> = [
  { id: "zh-commit", name: "中文提交信息", version: "0.3.0", summary: "按约定式提交写中文标题。" },
  { id: "esp32", name: "ESP32 标定脚本", version: "0.1.2", summary: "四路电阻传感器的标定步骤。" },
];

function SkillRow({
  skill,
  agents,
  uses,
  onToggle,
  action,
}: {
  skill: Skill;
  agents: ReadonlyArray<{ key: string; name: string }>;
  uses: (agent: string) => boolean;
  onToggle: (agent: string) => void;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{skill.name}</span>
        <span className="font-mono text-xs text-muted-foreground">v{skill.version}</span>
        <span className="text-xs text-muted-foreground">· {skill.owner}</span>
        <span className="ms-auto">{action}</span>
      </div>
      <div className="text-sm text-muted-foreground">{skill.summary}</div>
      <div className="flex flex-wrap gap-1">
        {agents.map((a) => (
          <Button
            key={a.key}
            size="xs"
            variant={uses(a.key) ? "secondary" : "ghost-muted"}
            aria-pressed={uses(a.key)}
            onClick={() => onToggle(a.key)}
          >
            <BotAvatar seed={a.name} size="xs" />
            {a.name}
          </Button>
        ))}
      </div>
    </li>
  );
}

function Skills({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const me = useViewer(viewer);
  const enterprise = isEnterprise(workspace);
  const agents = agentsOf(viewer, workspace, me.cos.name, useRegistryVersion());
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [submitted, setSubmitted] = useState<ReadonlySet<string>>(new Set());
  const uses = (skill: string, company: boolean) => (agent: string) =>
    overrides[`${skill}:${agent}`] ?? (company || agent === "cos");
  const flip = (skill: string, company: boolean) => (agent: string) =>
    setOverrides({ ...overrides, [`${skill}:${agent}`]: !uses(skill, company)(agent) });
  return (
    <section className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Skill 是 agent 做某件事的方法。点 agent 名字，决定你的哪个 agent 用它。
      </p>
      <div className={cn("flex flex-col gap-2", !enterprise && "hidden")}>
        <h2 className="text-sm font-medium">公司 skills</h2>
        <ul className="divide-y rounded-lg border bg-card">
          {COMPANY_SKILLS.map((s) => (
            <SkillRow
              key={s.id}
              skill={{ ...s, owner: `公司 · ${s.owner}` }}
              agents={agents}
              uses={uses(s.id, true)}
              onToggle={flip(s.id, true)}
              action={
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <LockIcon className="size-3" /> 公司维护，只能选用
                </span>
              }
            />
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">我的 skills</h2>
        <ul className="divide-y rounded-lg border bg-card">
          {MY_SKILLS.map((s) => (
            <SkillRow
              key={s.id}
              skill={{ ...s, owner: me.name }}
              agents={agents}
              uses={uses(s.id, false)}
              onToggle={flip(s.id, false)}
              action={
                !enterprise ? null : submitted.has(s.id) ? (
                  <Badge variant="warning">等公司审核</Badge>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setSubmitted(new Set([...submitted, s.id]))}
                  >
                    提交到公司
                  </Button>
                )
              }
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

export function TeamsPage({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const enterprise = isEnterprise(workspace);
  const picked = useTeamsTab();
  const tab = picked === "company" && !enterprise ? "mine" : picked;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {enterprise
              ? "配你自己的 agent 队伍，看公司有哪些 agent 能找。"
              : "配你自己的 agent 队伍。个人工作区没有公司 agents。"}
          </p>
        </div>
        <ToggleGroup
          aria-label="My Teams 分区"
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            const v = next[0];
            if (v === "mine" || v === "company" || v === "skills") setTeamsTab(v);
          }}
        >
          <Toggle value="mine">我的 agents</Toggle>
          {enterprise ? <Toggle value="company">公司 agents</Toggle> : null}
          <Toggle value="skills">Skills</Toggle>
        </ToggleGroup>
      </div>
      {tab === "mine" ? <MyAgents viewer={viewer} workspace={workspace} /> : null}
      {tab === "company" ? <CompanyAgents viewer={viewer} workspace={workspace} /> : null}
      {tab === "skills" ? <Skills viewer={viewer} workspace={workspace} /> : null}
    </div>
  );
}
