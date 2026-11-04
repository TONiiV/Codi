// PROTOTYPE, wipe me. My Teams: the viewer's own agents (their Chief of Staff and their own Chief
// Agent in each project), the company's agents they may call on, and the skills both use.
// Company agents and personal agents are separate sets; only your own are yours to change.
import { useNavigate } from "@tanstack/react-router";
import { LockIcon, MessageSquareIcon, Settings2Icon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { BotAvatar } from "./LighthouseChatList";
import { AGENT_STATES, Bloub, type AgentState } from "./LighthouseBloub";
import {
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
  COMPANY_AGENTS,
  PROJECTS,
  chiefName,
  projectsIn,
  roleIn,
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
  initial,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  role: "lead" | "member" | null;
  initial: CosSetup;
  onSave: (setup: CosSetup) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [setup, setSetup] = useState(initial);
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
            onSave({ ...setup, name: setup.name.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
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
                            {capped
                              ? "你在这个项目是成员，合并 PR 只有负责人的 agent 能做"
                              : p.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    上限是你在这个项目的角色（{role === "lead" ? "负责人" : "成员"}
                    ）。没勾的事它先问你；每次动手都用提问人的权限执行并记审计。
                  </p>
                </fieldset>
              ) : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">任务板和公司</legend>
                <Toggled
                  label="和任务板同步"
                  hint="开工前在板上领租约，完工后写回结果、产物和决定"
                  checked={setup.board}
                  onChange={(on) => set("board", on)}
                />
                <Toggled
                  label="可被公司主 Agent 调度"
                  hint="关掉后只有你能给它派活"
                  checked={setup.dispatchable}
                  onChange={(on) => set("dispatchable", on)}
                />
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <span className="flex flex-col">
                    <span>被派活时</span>
                    <span className="text-xs text-muted-foreground">
                      {setup.dispatchable ? "公司主 Agent 派来的活怎么处理" : "已关闭调度"}
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
  if (!setup.dispatchable) return "不接公司派活";
  return setup.onDispatch === "start" ? "公司可派活 · 直接开工" : "公司可派活 · 先进收件箱";
}

function AgentRow({
  viewer,
  project,
  onEdit,
}: {
  viewer: LighthouseViewer;
  project: string | null;
  onEdit: () => void;
}) {
  const setup = useCosSetup(viewer, project);
  const workers = useAllBots().filter((b) => b.kind === "worker" && b.project === project);
  const role = project ? roleIn(viewer, project) : null;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <BotAvatar seed={setup.name} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{setup.name}</span>
          <span className="text-xs text-muted-foreground">
            {project
              ? `${PROJECTS[project]?.name} · 你是${role === "lead" ? "负责人" : "成员"}`
              : "Chief of Staff · 总幕僚长，管你在所有项目里的 Chief Agent"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant="outline">{setup.harness}</Badge>
          {project ? (
            <Badge variant="outline">直接做：{powerSummary(setup) || "都先问"}</Badge>
          ) : null}
          <Badge variant={setup.board ? "info" : "outline"}>
            {setup.board ? "任务板同步" : "不同步任务板"}
          </Badge>
          <Badge variant="outline">{dispatchLine(setup)}</Badge>
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
  project,
  onClose,
}: {
  viewer: LighthouseViewer;
  project: string | null;
  onClose: () => void;
}) {
  const setup = useCosSetup(viewer, project);
  return (
    <AgentDialog
      title={project ? "设定你的 Chief Agent" : "设定你的 Chief of Staff"}
      subtitle={
        project
          ? `${PROJECTS[project]?.name}：项目里每人有自己的 Chief Agent，大家靠同一块任务板对齐。改的只是你的这位。`
          : "你的总幕僚长，管你在所有项目里的 Chief Agent。"
      }
      role={project ? roleIn(viewer, project) : null}
      initial={setup}
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
  ...projectsIn(workspace, viewer).open.map((id) => ({ key: id, name: chiefName(viewer, id) })),
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

const openIn = (workspace: string, viewer: LighthouseViewer, _version: number) =>
  projectsIn(workspace, viewer).open;

function MyAgents({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const version = useRegistryVersion();
  const me = useViewer(viewer);
  const open = openIn(workspace, viewer, version);
  const names = agentsOf(viewer, workspace, me.cos.name, version).map((a) => a.name);
  // undefined: closed; null: the Chief of Staff; a string: that project's Chief Agent.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        这些 agent 归你：一个 Chief of Staff，加你参与的每个项目里一个你自己的 Chief Agent。
        它们都跑在 {CLOUD}，只听你的，彼此靠任务板对齐。
      </p>
      <ul className="divide-y rounded-lg border bg-card">
        <AgentRow viewer={viewer} project={null} onEdit={() => setEditing(null)} />
        {open.map((id) => (
          <AgentRow key={id} viewer={viewer} project={id} onEdit={() => setEditing(id)} />
        ))}
      </ul>
      <AvatarShowcase names={names.slice(0, 6)} />
      {editing !== undefined ? (
        <EditAgent viewer={viewer} project={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </section>
  );
}

function CompanyAgents({ viewer }: { viewer: LighthouseViewer }) {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <LockIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          公司 agents 和你的 agents 是两套。公司 agents
          归公司，你只能找它们办事，不能改；它们按你的权限回答。 公司主 Agent
          只有在你打开「可被公司主 Agent 调度」时，才能给你的 agents 派活。
          {viewer === "admin" ? " 你是管理员，可以在设置里管理公司 agents。" : ""}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {COMPANY_AGENTS.map((a) => (
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
            <div className="mt-auto flex justify-end">
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
      <div className="flex flex-col gap-2">
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
                submitted.has(s.id) ? (
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
  const tab = useTeamsTab();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            配你自己的 agent 队伍，看公司有哪些 agent 能找。
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
          <Toggle value="company">公司 agents</Toggle>
          <Toggle value="skills">Skills</Toggle>
        </ToggleGroup>
      </div>
      {tab === "mine" ? <MyAgents viewer={viewer} workspace={workspace} /> : null}
      {tab === "company" ? <CompanyAgents viewer={viewer} /> : null}
      {tab === "skills" ? <Skills viewer={viewer} workspace={workspace} /> : null}
    </div>
  );
}
