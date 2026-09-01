import { countDecisions, formatElapsed, formatTokens } from "../../lib/derive";
import { useNow } from "../../lib/useNow";
import { PROVIDERS } from "../../mock/providers";
import type { Project } from "../../mock/types";
import {
  BOOT_TIME,
  currentProjectId,
  projectById,
  projectsFor,
  selectProject,
  useApp,
} from "../../store/app";
import { Avatar, Card, cx, EmptyNote, Meter, Rule, SectionHead, StatTile } from "../../ui/primitives";
import { DecisionTree } from "./DecisionTree";

const HEALTH_LABEL = { "on-track": "正常", "at-risk": "有风险", blocked: "受阻" } as const;
const HEALTH_TONE = { "on-track": "text-live", "at-risk": "text-warn", blocked: "text-stop" } as const;

function ProjectTabs() {
  const personaId = useApp((s) => s.personaId);
  const activeId = useApp(currentProjectId);
  const projects = projectsFor(personaId);

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-rule pb-4">
      {projects.map((project) => {
        const active = project.id === activeId;
        return (
          <button
            key={project.id}
            type="button"
            onClick={() => selectProject(project.id)}
            className="group text-left"
          >
            <div className={cx("eyebrow", active ? "text-ink" : "text-faint")}>{project.latin}</div>
            <div
              className={cx(
                "mt-1.5 flex items-baseline gap-2 transition-colors",
                active ? "text-ink" : "text-muted group-hover:text-ink-2",
              )}
            >
              <span className={cx("text-[14px]", active && "font-medium")}>{project.name}</span>
              <span className="num text-[11.5px] text-faint">{project.progress}%</span>
            </div>
            <div className={cx("mt-2 h-px w-full", active ? "bg-ink" : "bg-transparent")} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function LiveNow({ project }: { project: Project }) {
  const now = useNow(1000);
  const drift = (now - BOOT_TIME) / 60_000;
  const agents = useApp((s) => s.agents);

  if (project.live.length === 0) {
    return <EmptyNote>这个项目现在没有智能体在跑。</EmptyNote>;
  }

  return (
    <ul>
      {project.live.map((work, index) => {
        const agent = agents.find((a) => a.id === work.agentId);
        const minutes = work.elapsedMin + drift;
        const tokens = Math.round(work.tokens + work.burnPerMin * drift);
        return (
          <li key={work.agentId}>
            {index > 0 ? <Rule /> : null}
            <div className="flex items-center gap-4 py-4">
              <Avatar glyph={agent?.glyph ?? "?"} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium text-ink">{agent?.name}</span>
                  <span className="eyebrow text-faint">
                    {agent ? PROVIDERS[agent.provider].latin : ""}
                  </span>
                </div>
                <div className="mt-1 truncate text-[12.5px] text-muted">{work.task}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[13px] text-ink tabular-nums">
                  {formatElapsed(minutes)}
                </div>
                <div className="num mt-1 text-[11.5px] text-muted tabular-nums">
                  {formatTokens(tokens)} tokens
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Roadmap({ project }: { project: Project }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[720px] items-stretch">
        {project.roadmap.map((phase) => (
          <div key={phase.id} className="relative flex-1 pt-6 pr-6">
            <div className="absolute top-0 right-0 left-0 h-px bg-rule" />
            <div
              className={cx(
                "absolute top-0 left-0 size-[7px] -translate-y-[3px] rounded-full",
                phase.state === "future" ? "bg-rule-strong" : "bg-ink",
              )}
            />
            <div className="eyebrow text-faint">{phase.latin}</div>
            <div
              className={cx(
                "mt-2 text-[15px]",
                phase.state === "future" ? "text-muted" : "font-medium text-ink",
              )}
            >
              {phase.label}
            </div>
            <div className="mt-1 text-[11.5px] text-faint">{phase.span}</div>
            <div className="mt-3 pr-2">
              <Meter
                value={phase.progress}
                tone={phase.state === "active" ? "bg-ink" : "bg-rule-strong"}
              />
              <div className="num mt-1.5 text-[11px] text-muted">{phase.progress}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Milestones({ project }: { project: Project }) {
  return (
    <ol className="relative">
      {project.milestones.map((milestone, index) => (
        <li key={milestone.id} className="relative pl-[86px]">
          {index > 0 ? <Rule /> : null}
          <div className="py-5">
            <div className="num absolute top-5 left-0 w-[62px] text-[12px] text-faint tabular-nums">
              {milestone.date}
            </div>
            <div
              className={cx(
                "absolute top-[26px] left-[70px] size-[7px] rounded-full",
                milestone.state === "done" && "bg-ink",
                milestone.state === "active" && "bg-live",
                milestone.state === "future" && "border border-rule-strong bg-card",
              )}
            />
            <div
              className={cx(
                "text-[15.5px]",
                milestone.state === "future" ? "text-muted" : "font-medium text-ink",
              )}
            >
              {milestone.title}
            </div>
            <p className="body-cjk mt-1 max-w-[58ch] text-[13px] text-muted">{milestone.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ProjectsView() {
  const projectId = useApp(currentProjectId);
  const agents = useApp((s) => s.agents);
  const project = projectById(projectId);

  if (!project) {
    return (
      <div className="mx-auto max-w-[1180px] px-10 py-10">
        <EmptyNote>这个人物主页下还没有项目。</EmptyNote>
      </div>
    );
  }

  const decisions = countDecisions(project.decisions);
  const burn = project.live.reduce((total, work) => total + work.tokens, 0);
  const runningNames = project.live
    .map((work) => agents.find((a) => a.id === work.agentId)?.name)
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-10">
      <SectionHead
        eyebrow="PROJECTS"
        headline="项目看板"
        subtitle="每个项目一张仪表盘：谁在跑、进展到哪、下一个里程碑，以及那些还没拍板的决策。"
      />

      <div className="mt-8">
        <ProjectTabs />
      </div>

      <div className="mt-9">
        <SectionHead
          eyebrow={project.latin}
          headline={project.name}
          subtitle={project.summary}
          size="md"
          right={
            <span className={cx("eyebrow", HEALTH_TONE[project.health])}>
              {HEALTH_LABEL[project.health]}
            </span>
          }
        />
      </div>

      <div className="mt-7 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <StatTile eyebrow="PROGRESS" value={String(project.progress)} unit="%" note="总体完成度" />
        <StatTile
          eyebrow="RUNNING"
          value={String(project.live.length)}
          unit="位"
          note={runningNames || "暂无在跑智能体"}
          tone={project.live.length > 0 ? "text-live" : undefined}
        />
        <StatTile eyebrow="BURN" value={formatTokens(burn)} note="本轮 token 消耗" />
        <StatTile
          eyebrow="OPEN CALLS"
          value={String(decisions.open)}
          unit="项"
          note={`已采纳 ${decisions.chosen} · 已否决 ${decisions.rejected}`}
          tone={decisions.open > 0 ? "text-warn" : undefined}
        />
      </div>

      <div className="mt-14">
        <SectionHead eyebrow="LIVE NOW" headline="正在进行" size="md" />
        <div className="mt-4">
          <LiveNow project={project} />
        </div>
      </div>

      <div className="mt-14">
        <SectionHead
          eyebrow="ROADMAP"
          headline="路线图"
          subtitle="从立项到灰度的整条路，以及每一段现在走到哪。"
          size="md"
        />
        <div className="mt-7">
          <Roadmap project={project} />
        </div>
      </div>

      <div className="mt-14">
        <SectionHead eyebrow="MILESTONES" headline="里程碑" size="md" />
        <div className="mt-4">
          <Milestones project={project} />
        </div>
      </div>

      <div className="mt-14 pb-10">
        <SectionHead
          eyebrow="DECISION TREE"
          headline="决策树"
          subtitle="点节点右侧的加号可以展开分支。实线框是已采纳的路径，虚线是被否决的，橙色虚线是还没拍板的。"
          size="md"
        />
        <Card className="mt-6 overflow-hidden" padded={false}>
          <div className="p-7">
            <DecisionTree root={project.decisions} />
          </div>
        </Card>
      </div>
    </div>
  );
}
