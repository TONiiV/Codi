// PROTOTYPE, wipe me. Telescope projects are Microscope (Code) projects: the same title, root,
// repository and machine. Adding one goes through Code's own add-project flow. Every member
// adds and sets up their own Chief Agent in each project.
import { FolderGit2Icon, LockIcon, PencilIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useProjects } from "../../state/entities";
import { BotAvatar } from "./LighthouseChatList";
import { AgentDialog, CLOUD, freshSetup, powerSummary } from "./LighthouseTeams";
import {
  addChiefAgent,
  linkProject,
  saveCos,
  renameChiefOfStaff,
  useCosSetup,
  useRegistryVersion,
  useViewer,
} from "./lighthouseActions";
import {
  PROJECT_COS,
  PROJECT_SOURCE,
  PROJECTS,
  hasChief,
  isEnterprise,
  projectsIn,
  roleIn,
  type LighthouseViewer,
} from "./lighthouseData";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface Source {
  title: string;
  root: string;
  repo: string;
  machine: string;
}

const sourceLine = (s: Source) => `${s.title} · ${s.root} · ${s.repo} · 代码在 ${s.machine}`;

/** Your own 个人助理 (Chief of Staff): only you can rename it. */
function ChiefOfStaffCard({ viewer, name }: { viewer: LighthouseViewer; name: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <section className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <BotAvatar seed={name} size="lg" />
      <div className="min-w-0 flex-1">
        {draft === null ? (
          <div className="font-medium">{name}</div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim()) renameChiefOfStaff(viewer, draft.trim());
              setDraft(null);
            }}
          >
            <Input
              nativeInput
              size="sm"
              autoFocus
              aria-label="个人助理名字"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
            />
            <Button type="submit" size="sm">
              保存
            </Button>
          </form>
        )}
        <div className="text-xs text-muted-foreground">
          你的个人助理（Chief of Staff），管你在各个项目里的 Chief Agent · 运行在 {CLOUD}
        </div>
      </div>
      {draft === null ? (
        <Button size="xs" variant="ghost-muted" onClick={() => setDraft(name)}>
          <PencilIcon /> 改名
        </Button>
      ) : null}
    </section>
  );
}

function ProjectRow({
  viewer,
  id,
  has,
  onEdit,
}: {
  viewer: LighthouseViewer;
  id: string;
  /** Whether the viewer has added their own Chief Agent here yet. */
  has: boolean;
  onEdit: () => void;
}) {
  const setup = useCosSetup(viewer, id);
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
        {has ? null : (
          <span className="text-xs text-muted-foreground">
            你是{roleIn(viewer, id) === "lead" ? "负责人" : "成员"} · 还没有你的 Chief Agent
          </span>
        )}
        <span className={cn("flex items-center gap-2", !has && "hidden")}>
          <BotAvatar seed={setup.name} size="sm" />
          <span className="flex flex-col">
            <span className="whitespace-nowrap">{setup.name}</span>
            <span className="text-xs text-muted-foreground">
              你是{roleIn(viewer, id) === "lead" ? "负责人" : "成员"} · 直接做：
              {powerSummary(setup) || "都先问"}
            </span>
          </span>
        </span>
      </td>

      <td className="px-3 py-2.5 text-end">
        {has ? (
          <Button size="xs" variant="ghost-muted" onClick={onEdit}>
            <Settings2Icon /> 设定
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={onEdit}>
            <PlusIcon /> 添加 Chief Agent
          </Button>
        )}
      </td>
    </tr>
  );
}

const HEADS = ["项目", "仓库", "代码所在机器", "你的 Chief Agent（公司云）", ""];

// Registries are module data; passing the version makes the React Compiler recompute.
const visible = (workspace: string, viewer: LighthouseViewer, _version: number) =>
  projectsIn(workspace, viewer);
const rootsOf = (_version: number) => new Set(Object.values(PROJECT_SOURCE).map((s) => s.root));
const chiefIn = (viewer: LighthouseViewer, id: string, _version: number) => hasChief(viewer, id);

export function ProjectsPage({
  viewer,
  workspace,
}: {
  viewer: LighthouseViewer;
  workspace: string;
}) {
  const version = useRegistryVersion();
  const me = useViewer(viewer);
  const { open, locked } = visible(workspace, viewer, version);
  const code = useProjects().filter((p) => p.isScratch !== true && p.archivedAt == null);
  const linkedRoots = rootsOf(version);
  const unlinked = code.filter((p) => !linkedRoots.has(p.workspaceRoot));
  const [editing, setEditing] = useState<
    | { kind: "edit"; id: string }
    | { kind: "add"; id: string }
    | { kind: "link"; source: Source }
    | null
  >(null);
  const editingSetup = useCosSetup(viewer, editing?.kind === "edit" ? editing.id : "");
  const enterprise = isEnterprise(workspace);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            和 Microscope 里是同一个项目：名字、目录、仓库、机器都一样。每个成员在项目里添加自己的
            Chief Agent，大家靠同一块任务板对齐。
          </p>
        </div>
        <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
          <PlusIcon /> 添加项目
        </Button>
      </div>

      <ChiefOfStaffCard viewer={viewer} name={me.cos.name} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">在 Telescope 里</h2>
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
                <ProjectRow
                  key={id}
                  viewer={viewer}
                  id={id}
                  has={chiefIn(viewer, id, version)}
                  onEdit={() =>
                    setEditing({ kind: chiefIn(viewer, id, version) ? "edit" : "add", id })
                  }
                />
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
          <h2 className="text-sm font-medium">Microscope 里还没接入的项目</h2>
          <span className="text-xs text-muted-foreground">
            接入后，Chief Agent 会出现在左侧聊天列表
          </span>
        </div>
        {unlinked.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Microscope 里的项目都已接入。新项目用「添加项目」，和 Microscope
            侧边栏的添加项目是同一个流程。
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
                    接入并设 Chief Agent
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing?.kind === "edit" ? (
        <AgentDialog
          title="设定你的 Chief Agent"
          subtitle={sourceLine({
            title: PROJECTS[editing.id]?.name ?? editing.id,
            ...(PROJECT_SOURCE[editing.id] ?? { root: "", repo: "", machine: "" }),
          })}
          role={roleIn(viewer, editing.id)}
          enterprise={enterprise}
          initial={editingSetup}
          onClose={() => setEditing(null)}
          onSave={(setup) => {
            saveCos(viewer, editing.id, setup);
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === "add" ? (
        <AgentDialog
          title="添加你的 Chief Agent"
          subtitle={`${PROJECTS[editing.id]?.name ?? editing.id}：只属于你，靠任务板和其他成员的 Chief Agent 对齐。`}
          role={roleIn(viewer, editing.id)}
          enterprise={enterprise}
          initial={freshSetup(PROJECT_COS[editing.id]?.name ?? "Chief Agent")}
          onClose={() => setEditing(null)}
          onSave={(setup) => {
            addChiefAgent(viewer, editing.id, setup);
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === "link" ? (
        <AgentDialog
          title={`接入 ${editing.source.title}`}
          subtitle={`${sourceLine(editing.source)}。你是负责人；其他成员加入后各有自己的 Chief Agent。`}
          role="lead"
          enterprise={enterprise}
          initial={freshSetup(`${editing.source.title} Chief Agent`)}
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
