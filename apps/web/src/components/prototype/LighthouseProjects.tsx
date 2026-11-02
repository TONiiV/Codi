// PROTOTYPE, wipe me. Lighthouse projects are Code projects: the same title, workspace root,
// repository and machine. Adding one goes through Code's own add-project flow; linking it
// gives it a Chief of Staff, whose owner and powers are set here.
import { FolderGit2Icon, LockIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useId, useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useProjects } from "../../state/entities";
import { BotAvatar } from "./LighthouseChatList";
import {
  linkProject,
  saveCos,
  useCosSetup,
  useLinkedProjects,
  type CosPower,
  type CosSetup,
} from "./lighthouseActions";
import {
  PROJECT_SOURCE,
  PROJECTS,
  VIEWERS,
  projectsIn,
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

const POWERS: ReadonlyArray<{ id: CosPower; label: string; hint: string }> = [
  { id: "ticket", label: "开工单", hint: "把任务拆成工单，挂到任务下面" },
  { id: "worker", label: "派 Worker", hint: "在项目的机器上起 Worker 接工单" },
  { id: "answer", label: "回答成员", hint: "用成员自己的权限回答项目里的问题" },
  { id: "merge", label: "合并 PR", hint: "CI 绿、评审过就合并；关掉时每次都先问负责人" },
];

const HARNESSES = [
  "Codi 滚动线程 / Sonnet",
  "Codi 滚动线程 / Opus",
  "Claude Code / Sonnet",
  "Codex / gpt-5",
];
const MACHINES = ["lighthouse-01", "mac-mini-2", "ws-lin-3", "本机"];
const MEMBERS = Object.values(VIEWERS).map((v) => v.name);

interface Source {
  title: string;
  root: string;
  repo: string;
  machine: string;
}

function CosDialog({
  title,
  source,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  source: Source;
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
            onSave(setup);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {source.title} · {source.root} · {source.repo} · {source.machine}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <BotAvatar seed={setup.name} size="lg" />
                <Label className="flex flex-1 flex-col items-stretch" htmlFor={`${id}-name`}>
                  幕僚长名字
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
                  委派给（负责人）
                  <Select value={setup.owner} onValueChange={(v) => v && set("owner", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {MEMBERS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
                <Label className="flex flex-col items-stretch">
                  汇报
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
                  跑在哪台机器
                  <Select value={setup.machine} onValueChange={(v) => v && set("machine", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {MACHINES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">不用问 {setup.owner} 就能做</legend>
                {POWERS.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox
                      checked={setup.powers.includes(p.id)}
                      onCheckedChange={(on) => toggle(p.id, on)}
                    />
                    <span className="flex flex-col">
                      <span>{p.label}</span>
                      <span className="text-xs text-muted-foreground">{p.hint}</span>
                    </span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">
                  没勾的事，幕僚长先问 {setup.owner}。它每次动手都以提问人的权限执行并记审计。
                </p>
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

function powerSummary(setup: CosSetup) {
  return POWERS.filter((p) => setup.powers.includes(p.id))
    .map((p) => p.label)
    .join("、");
}

function ProjectRow({ id, onEdit }: { id: string; onEdit: () => void }) {
  const setup = useCosSetup(id);
  const source = PROJECT_SOURCE[id];
  return (
    <tr className="border-b last:border-b-0 hover:bg-accent/40">
      <td className="px-3 py-2.5">
        <div className="font-medium">{PROJECTS[id]?.name}</div>
        <div className="max-w-48 truncate font-mono text-xs text-muted-foreground">
          {source?.root}
        </div>
      </td>
      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
        {source?.repo}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
        {source?.machine}
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2">
          <BotAvatar seed={setup.name} size="sm" />
          <span className="flex flex-col">
            <span className="whitespace-nowrap">{setup.name}</span>
            <span className="text-xs text-muted-foreground">
              委派给 {setup.owner} · 直接做：{powerSummary(setup) || "都先问"}
            </span>
          </span>
        </span>
      </td>

      <td className="px-3 py-2.5 text-end">
        <Button size="xs" variant="ghost-muted" onClick={onEdit}>
          <Settings2Icon /> 设定
        </Button>
      </td>
    </tr>
  );
}

const HEADS = ["项目", "仓库", "机器", "幕僚长", ""];

// Registries are module data; passing `linked` makes the React Compiler recompute on a link.
const visible = (workspace: string, viewer: LighthouseViewer, _linked: ReadonlyArray<string>) =>
  projectsIn(workspace, viewer);
const rootsOf = (_linked: ReadonlyArray<string>) =>
  new Set(Object.values(PROJECT_SOURCE).map((s) => s.root));

export function ProjectsPage({
  viewer,
  workspace,
}: {
  viewer: LighthouseViewer;
  workspace: string;
}) {
  const linked = useLinkedProjects();
  const { open, locked } = visible(workspace, viewer, linked);
  const code = useProjects().filter((p) => p.isScratch !== true && p.archivedAt == null);
  const linkedRoots = rootsOf(linked);
  const unlinked = code.filter((p) => !linkedRoots.has(p.workspaceRoot));
  const [editing, setEditing] = useState<
    { kind: "edit"; id: string } | { kind: "link"; source: Source } | null
  >(null);
  const editingSetup = useCosSetup(editing?.kind === "edit" ? editing.id : "");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            和 Code 里是同一个项目：名字、目录、仓库、机器都一样。Lighthouse 只多一位幕僚长。
          </p>
        </div>
        <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
          <PlusIcon /> 添加项目
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">在 Lighthouse 里</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                {HEADS.map((h) => (
                  <th key={h || "actions"} className="px-3 py-2 text-start font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {open.map((id) => (
                <ProjectRow key={id} id={id} onEdit={() => setEditing({ kind: "edit", id })} />
              ))}
            </tbody>
          </table>
        </div>
        {locked.length > 0 ? (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {locked.map((id) => (
              <span key={id} className="inline-flex items-center gap-1">
                <LockIcon className="size-3" /> {PROJECTS[id]?.name}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Code 里还没接入的项目</h2>
          <span className="text-xs text-muted-foreground">接入后，幕僚长会出现在左侧聊天列表</span>
        </div>
        {unlinked.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Code 里的项目都已接入。新项目用「添加项目」，和 Code 侧边栏的添加项目是同一个流程。
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {unlinked.map((p) => {
              const source: Source = {
                title: p.title,
                root: p.workspaceRoot,
                repo: p.repositoryIdentity?.canonicalKey ?? "本地目录",
                machine: "本机",
              };
              return (
                <li
                  key={`${p.environmentId}:${p.id}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <FolderGit2Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.title}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {p.workspaceRoot}
                    </span>
                  </span>
                  <Badge variant="outline">{source.repo}</Badge>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEditing({ kind: "link", source })}
                  >
                    接入并设幕僚长
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing?.kind === "edit" ? (
        <CosDialog
          title="设定幕僚长"
          source={{
            title: PROJECTS[editing.id]?.name ?? editing.id,
            ...(PROJECT_SOURCE[editing.id] ?? { root: "", repo: "", machine: "" }),
          }}
          initial={editingSetup}
          onClose={() => setEditing(null)}
          onSave={(setup) => {
            saveCos(editing.id, setup);
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === "link" ? (
        <CosDialog
          title={`接入 ${editing.source.title}`}
          source={editing.source}
          initial={{
            name: `${editing.source.title} 幕僚长`,
            owner: VIEWERS[viewer].name,
            harness: HARNESSES[0]!,
            machine: MACHINES[0]!,
            powers: ["ticket", "worker", "answer"],
            report: "daily",
          }}
          onClose={() => setEditing(null)}
          onSave={(setup) => {
            linkProject(editing.source, workspace, viewer, setup);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
