import { useState } from "react";
import { countDecisions, formatTokens, hoursFromNow, projectBurn } from "../lib/derive";
import { STATUS_LABEL, STATUS_TONE } from "../mock/providers";
import {
  addCapture,
  agentsFor,
  captureTabs,
  personaById,
  projectsFor,
  setCaptureTab,
  setSection,
  todosFor,
  useApp,
} from "../store/app";
import { DeskIllustration, IconArrowDown } from "../ui/icons";
import { Avatar, Card, cx, Pill, Rule, SectionHead, StatTile, StatusDot } from "../ui/primitives";
import { shallowEqual } from "../store/store";

function greetingEyebrow(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "STILL UP";
  if (hour < 11) return "GOOD MORNING";
  if (hour < 14) return "GOOD NOON";
  if (hour < 18) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

function QuickCapture() {
  const tabId = useApp((s) => s.captureTabId);
  const captures = useApp((s) => s.captures, shallowEqual);
  const [draft, setDraft] = useState("");
  const tab = captureTabs.find((t) => t.id === tabId)!;
  const visible = captures.filter((note) => note.tabId === tabId);

  const submit = () => {
    addCapture(draft);
    setDraft("");
  };

  return (
    <section>
      <SectionHead
        eyebrow="QUICK CAPTURE"
        headline="随手记下来"
        subtitle="想法不该等一个合适的位置。先落这里，稍后再分配给项目或智能体。"
        size="md"
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {captureTabs.map((item) => (
          <Pill key={item.id} active={item.id === tabId} onClick={() => setCaptureTab(item.id)}>
            {item.label}
          </Pill>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-rule bg-card px-5 py-3.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={tab.placeholder}
          className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-full border border-ink bg-ink px-4 py-1.5 text-[12.5px] text-paper transition-opacity disabled:cursor-not-allowed disabled:opacity-25"
        >
          记下
        </button>
      </div>

      {visible.length > 0 ? (
        <ul className="mt-5 space-y-0">
          {visible.map((note, index) => (
            <li key={note.id}>
              {index > 0 ? <Rule /> : null}
              <div className="flex items-baseline gap-5 py-3.5">
                <span className="num w-[68px] shrink-0 text-[12px] text-faint">{note.time}</span>
                <span className="body-cjk flex-1 text-[14px] text-ink-2">{note.text}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-[13px] text-faint">这一类还什么都没有。</p>
      )}
    </section>
  );
}

function AgentPulse() {
  const personaId = useApp((s) => s.personaId);
  const agents = useApp((s) => agentsFor(s, s.personaId), shallowEqual);
  const ordered = [...agents].sort((a, b) =>
    a.status === "idle" ? 1 : b.status === "idle" ? -1 : 0,
  );

  return (
    <section>
      <SectionHead
        eyebrow="AGENT PULSE"
        headline="智能体动态"
        subtitle={`${agents.filter((a) => a.status !== "idle").length} 位正在工作`}
        size="md"
        right={
          <button
            type="button"
            onClick={() => setSection("agents")}
            className="eyebrow text-muted transition-colors hover:text-ink"
          >
            查看全部
          </button>
        }
      />
      <ul className="mt-5">
        {ordered.slice(0, 5).map((agent, index) => (
          <li key={`${personaId}-${agent.id}`}>
            {index > 0 ? <Rule /> : null}
            <div className="flex items-center gap-4 py-3.5">
              <Avatar glyph={agent.glyph} size={30} dim={agent.status === "idle"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium text-ink">{agent.name}</span>
                  <span className="eyebrow text-faint">{agent.role}</span>
                </div>
                <div className="mt-1 truncate text-[12.5px] text-muted">{agent.activity}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <StatusDot status={agent.status} />
                <span className={cx("text-[12px]", STATUS_TONE[agent.status])}>
                  {STATUS_LABEL[agent.status]}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UpNext() {
  const personaId = useApp((s) => s.personaId);
  const todos = todosFor(personaId)
    .filter((todo) => todo.state !== "done" && hoursFromNow(todo) > -1.5)
    .sort((a, b) => a.startH - b.startH)
    .slice(0, 5);
  const projects = projectsFor(personaId);

  return (
    <section>
      <SectionHead
        eyebrow="UP NEXT"
        headline="接下来"
        subtitle="由项目自动生成的待办，按开始时间排列。"
        size="md"
        right={
          <button
            type="button"
            onClick={() => setSection("calendar")}
            className="eyebrow text-muted transition-colors hover:text-ink"
          >
            打开日历
          </button>
        }
      />
      <ul className="mt-5">
        {todos.map((todo, index) => {
          const delta = hoursFromNow(todo);
          const when =
            delta < 0 ? "进行中" : delta < 1 ? `${Math.round(delta * 60)} 分钟后` : `${delta.toFixed(1)} 小时后`;
          return (
            <li key={todo.id}>
              {index > 0 ? <Rule /> : null}
              <div className="flex items-baseline gap-4 py-3.5">
                <span
                  className={cx(
                    "num w-[72px] shrink-0 text-[12px]",
                    delta < 0 ? "text-live" : "text-faint",
                  )}
                >
                  {when}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-ink">{todo.title}</div>
                  <div className="mt-1 text-[12px] text-muted">
                    {projects.find((p) => p.id === todo.projectId)?.name} · {todo.label}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TodayView() {
  const persona = useApp((s) => personaById(s.personaId));
  const personaId = persona.id;
  const runningCount = useApp(
    (s) => agentsFor(s, s.personaId).filter((a) => a.status !== "idle").length,
  );
  const projects = projectsFor(personaId);
  const todayTodos = todosFor(personaId).filter(
    (todo) => todo.startH >= -6 && todo.startH < 18 && todo.state !== "done",
  );
  const burn = projects.reduce((total, project) => total + projectBurn(project), 0);
  const openDecisions = projects.reduce(
    (total, project) => total + countDecisions(project.decisions).open,
    0,
  );

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-10">
      <SectionHead
        eyebrow={greetingEyebrow()}
        headline={persona.greeting}
        subtitle={persona.brief}
      />

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card className="relative flex min-h-[268px] flex-col justify-between overflow-hidden">
          <div className="relative z-10 max-w-[54%]">
            <div className="eyebrow text-faint">TODAY'S FOCUS</div>
            <p className="mt-4 font-serif text-[25px] leading-[1.45] text-ink">
              {persona.motto}
            </p>
          </div>
          <div className="relative z-10 max-w-[56%]">
            <Rule className="mb-4" />
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="text-muted">最要紧的一件事</span>
              <span className="text-ink">
                {todayTodos[0]?.title ?? "今天没有安排，去写点什么吧"}
              </span>
            </div>
          </div>
          <DeskIllustration className="pointer-events-none absolute -right-6 bottom-2 h-[214px] text-rule-strong" />
        </Card>

        <div className="grid grid-cols-2 gap-5">
          <StatTile
            eyebrow="RUNNING"
            value={String(runningCount)}
            unit="位"
            note="正在工作的智能体"
            tone={runningCount > 0 ? "text-live" : undefined}
          />
          <StatTile
            eyebrow="TODOS"
            value={String(todayTodos.length)}
            unit="条"
            note="今日待办"
          />
          <StatTile eyebrow="BURN" value={formatTokens(burn)} note="今日 token 消耗" />
          <StatTile
            eyebrow="OPEN CALLS"
            value={String(openDecisions)}
            unit="项"
            note="未决的关键决策"
            tone={openDecisions > 4 ? "text-warn" : undefined}
          />
        </div>
      </div>

      <div className="mt-14">
        <QuickCapture />
      </div>

      <div className="mt-14 grid grid-cols-1 gap-14 lg:grid-cols-2">
        <UpNext />
        <AgentPulse />
      </div>

      <div className="mt-16 flex items-center justify-center gap-2 pb-6 text-faint">
        <IconArrowDown className="size-4" />
        <span className="eyebrow">END OF TODAY</span>
      </div>
    </div>
  );
}
