import { clockOf, dayLabel, dayOffset } from "../../lib/derive";
import { useNow } from "../../lib/useNow";
import type { Todo, TodoLabel } from "../../mock/types";
import {
  BOOT_TIME,
  clearFilters,
  currentProjectId,
  projectById,
  projectsFor,
  selectProject,
  setCalendarView,
  setFocus,
  setSection,
  todoEnd,
  todoStart,
  todosFor,
  toggleLabelFilter,
  toggleProjectFilter,
  useApp,
  type FocusMode,
} from "../../store/app";
import { shallowEqual } from "../../store/store";
import { Avatar, cx, EmptyNote, Pill, Rule, SectionHead } from "../../ui/primitives";

const LABELS: TodoLabel[] = ["研发", "设计", "评审", "发布", "调研"];

const FOCUS_OPTIONS: Array<{ id: FocusMode; label: string }> = [
  { id: "all", label: "全部" },
  { id: "day", label: "未来 1 天" },
  { id: "hours3", label: "未来 3 小时" },
];

function useVisibleTodos() {
  const personaId = useApp((s) => s.personaId);
  const focus = useApp((s) => s.focus);
  const projectFilters = useApp((s) => s.projectFilters, shallowEqual);
  const labelFilters = useApp((s) => s.labelFilters, shallowEqual);
  const now = useNow(60_000);

  const elapsedH = (now - BOOT_TIME) / 3_600_000;
  const windowStart = focus === "all" ? -Infinity : elapsedH - 0.5;
  const windowEnd =
    focus === "hours3" ? elapsedH + 3 : focus === "day" ? elapsedH + 24 : Infinity;

  const todos = todosFor(personaId)
    .filter((todo) => projectFilters.length === 0 || projectFilters.includes(todo.projectId))
    .filter((todo) => labelFilters.length === 0 || labelFilters.includes(todo.label))
    .filter((todo) => todo.startH + todo.durH > windowStart && todo.startH < windowEnd)
    .sort((a, b) => a.startH - b.startH);

  return { todos, elapsedH, windowStart, windowEnd, focus };
}

function TodoRow({ todo, large }: { todo: Todo; large: boolean }) {
  const agents = useApp((s) => s.agents);
  const agent = agents.find((a) => a.id === todo.agentId);
  const project = projectById(todo.projectId);
  const start = todoStart(todo);
  const end = todoEnd(todo);

  return (
    <div className={cx("flex items-baseline gap-6", large ? "py-7" : "py-4")}>
      <div className={cx("num shrink-0 text-faint tabular-nums", large ? "w-[124px]" : "w-[104px]")}>
        <div className={cx(large ? "text-[17px] text-ink" : "text-[13px] text-ink-2")}>
          {clockOf(start)}
        </div>
        <div className={cx("mt-1", large ? "text-[12.5px]" : "text-[11.5px]")}>
          至 {clockOf(end)}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={cx(
            "text-ink",
            large ? "text-[22px] leading-snug font-medium" : "text-[14.5px]",
            todo.state === "done" && "text-muted line-through decoration-rule-strong",
          )}
        >
          {todo.title}
        </div>
        <div
          className={cx(
            "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted",
            large ? "text-[13px]" : "text-[12px]",
          )}
        >
          <span>{project?.name}</span>
          <span className="text-faint">·</span>
          <span>{todo.label}</span>
          {agent ? (
            <>
              <span className="text-faint">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Avatar glyph={agent.glyph} size={large ? 22 : 18} />
                {agent.name}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {todo.state === "doing" ? (
        <span className="eyebrow shrink-0 text-live">进行中</span>
      ) : todo.state === "done" ? (
        <span className="eyebrow shrink-0 text-faint">已完成</span>
      ) : null}
    </div>
  );
}

function Agenda() {
  const { todos, focus } = useVisibleTodos();
  const large = focus !== "all";

  if (todos.length === 0) {
    return <EmptyNote>这个时间窗里没有待办。放松一下，或者把范围放宽。</EmptyNote>;
  }

  if (large) {
    return (
      <div>
        {todos.map((todo, index) => (
          <div key={todo.id}>
            {index > 0 ? <Rule /> : null}
            <TodoRow todo={todo} large />
          </div>
        ))}
      </div>
    );
  }

  const days = new Map<number, Todo[]>();
  todos.forEach((todo) => {
    const offset = dayOffset(todoStart(todo));
    const bucket = days.get(offset);
    if (bucket) bucket.push(todo);
    else days.set(offset, [todo]);
  });

  return (
    <div className="space-y-12">
      {[...days.entries()].map(([offset, items]) => (
        <section key={offset}>
          <div className="flex items-baseline gap-3 border-b border-rule pb-3">
            <span className="eyebrow text-faint">
              {offset === 0 ? "TODAY" : offset === 1 ? "TOMORROW" : `DAY +${offset}`}
            </span>
            <span className="text-[16px] font-medium text-ink">{dayLabel(offset)}</span>
            <span className="num ml-auto text-[12px] text-muted">{items.length} 条</span>
          </div>
          <div>
            {items.map((todo, index) => (
              <div key={todo.id}>
                {index > 0 ? <Rule /> : null}
                <TodoRow todo={todo} large={false} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const LANE_W = 196;

function Gantt() {
  const { todos, elapsedH, focus } = useVisibleTodos();
  const personaId = useApp((s) => s.personaId);
  const agents = useApp((s) => s.agents);

  // Time is measured in pixels rather than percent so a one-hour task stays
  // the same readable size whether the window is three hours or four days.
  const pxPerHour = focus === "hours3" ? 210 : focus === "day" ? 62 : 30;
  const tickEvery = focus === "hours3" ? 0.5 : focus === "day" ? 3 : 12;
  const span = focus === "hours3" ? 3.5 : focus === "day" ? 24 : 84;
  const start = focus === "all" ? -6 : elapsedH - 0.5;

  if (todos.length === 0) {
    return <EmptyNote>这个时间窗里没有待办。</EmptyNote>;
  }

  const grouped = projectsFor(personaId)
    .map((project) => ({ project, items: todos.filter((t) => t.projectId === project.id) }))
    .filter((group) => group.items.length > 0);

  const trackW = span * pxPerHour;
  // Snap gridlines to round clock times so the axis reads 00:00 / 12:00 rather
  // than whatever minute the prototype happened to boot at.
  const stepMs = tickEvery * 3_600_000;
  const firstTickMs = Math.ceil((BOOT_TIME + start * 3_600_000) / stepMs) * stepMs;
  const tickCount = Math.floor((span * 3_600_000 - (firstTickMs - (BOOT_TIME + start * 3_600_000))) / stepMs);
  const ticks = Array.from({ length: Math.max(tickCount + 1, 1) }, (_, index) => {
    const ms = firstTickMs + stepMs * index;
    return { x: ((ms - BOOT_TIME) / 3_600_000 - start) * pxPerHour, date: new Date(ms) };
  });
  const nowX = (elapsedH - start) * pxPerHour;

  return (
    <div className="overflow-x-auto pb-3">
      <div style={{ width: LANE_W + trackW }}>
        <div className="flex">
          <div style={{ width: LANE_W }} className="shrink-0" />
          <div style={{ width: trackW }} className="relative border-b border-rule pb-6">
            {ticks.map((tick, index) => (
              <span
                key={index}
                style={{ left: tick.x }}
                className="num absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-faint tabular-nums"
              >
                {span > 30
                  ? `${tick.date.getMonth() + 1}/${tick.date.getDate()} ${clockOf(tick.date)}`
                  : clockOf(tick.date)}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <div
            style={{ left: LANE_W, width: trackW }}
            className="pointer-events-none absolute inset-y-0"
          >
            {ticks.map((tick, index) => (
              <div key={index} style={{ left: tick.x }} className="absolute inset-y-0 w-px bg-rule" />
            ))}
            {nowX >= 0 && nowX <= trackW ? (
              <div style={{ left: nowX }} className="absolute inset-y-0 w-px bg-live" title="现在" />
            ) : null}
          </div>

          {grouped.map((group) => (
            <div key={group.project.id} className="relative">
              <div className="flex items-baseline gap-2 pt-7 pb-2">
                <span className="eyebrow text-faint">{group.project.latin}</span>
                <span className="text-[13px] font-medium text-ink">{group.project.name}</span>
              </div>
              {group.items.map((todo) => {
                const rawLeft = (todo.startH - start) * pxPerHour;
                const left = Math.max(0, rawLeft);
                const width = Math.max(
                  26,
                  Math.min(todo.durH * pxPerHour - (left - rawLeft), trackW - left),
                );
                const agent = agents.find((a) => a.id === todo.agentId);
                return (
                  <div key={todo.id} className="flex items-center">
                    <div
                      style={{ width: LANE_W }}
                      className="shrink-0 truncate py-1.5 pr-5 text-[12.5px] text-ink-2"
                      title={todo.title}
                    >
                      {todo.title}
                    </div>
                    <div style={{ width: trackW }} className="relative h-9 shrink-0">
                      <div
                        style={{ left, width }}
                        className={cx(
                          "absolute top-1/2 flex h-[24px] -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-[6px] border px-2",
                          todo.state === "doing" && "border-live bg-live/12",
                          todo.state === "todo" && "border-rule-strong bg-card",
                          todo.state === "done" && "border-rule bg-paper-sunk",
                        )}
                        title={`${todo.title} · ${todo.label} · ${agent?.name ?? ""}`}
                      >
                        {width > 68 ? (
                          <span className="truncate text-[10.5px] whitespace-nowrap text-muted">
                            {agent?.name} · {todo.label}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CalendarView() {
  const personaId = useApp((s) => s.personaId);
  const view = useApp((s) => s.calendarView);
  const focus = useApp((s) => s.focus);
  const projectFilters = useApp((s) => s.projectFilters, shallowEqual);
  const labelFilters = useApp((s) => s.labelFilters, shallowEqual);
  const activeProjectId = useApp(currentProjectId);
  const { todos } = useVisibleTodos();
  const projects = projectsFor(personaId);
  const quiet = focus !== "all";
  const filtered = projectFilters.length > 0 || labelFilters.length > 0;

  return (
    <div className={cx("mx-auto max-w-[1180px] px-10", quiet ? "py-16" : "py-10")}>
      <SectionHead
        eyebrow={quiet ? "FOCUS" : "CALENDAR"}
        headline={quiet ? (focus === "hours3" ? "接下来三小时" : "接下来一天") : "日历"}
        subtitle={
          quiet
            ? `只剩 ${todos.length} 件事。其余的都先收起来了。`
            : "项目生成的待办会自动落到这里。可以按项目和标签筛选，也可以只看眼前的一小段。"
        }
        right={
          <div className="flex items-center gap-2">
            {FOCUS_OPTIONS.map((option) => (
              <Pill
                key={option.id}
                size="sm"
                active={focus === option.id}
                onClick={() => setFocus(option.id)}
              >
                {option.label}
              </Pill>
            ))}
          </div>
        }
      />

      <div className={cx("space-y-4", quiet ? "mt-8" : "mt-8")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow w-[64px] text-faint">VIEW</span>
          <Pill size="sm" active={view === "agenda"} onClick={() => setCalendarView("agenda")}>
            日程
          </Pill>
          <Pill size="sm" active={view === "gantt"} onClick={() => setCalendarView("gantt")}>
            甘特图
          </Pill>
          {quiet && filtered ? (
            <button
              type="button"
              onClick={clearFilters}
              className="eyebrow ml-3 text-muted transition-colors hover:text-ink"
            >
              筛选仍生效 · 清除
            </button>
          ) : null}
        </div>
      </div>

      {quiet ? null : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow w-[64px] text-faint">项目</span>
            {projects.map((project) => (
              <Pill
                key={project.id}
                size="sm"
                active={projectFilters.includes(project.id)}
                onClick={() => toggleProjectFilter(project.id)}
              >
                {project.name}
              </Pill>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow w-[64px] text-faint">标签</span>
            {LABELS.map((label) => (
              <Pill
                key={label}
                size="sm"
                active={labelFilters.includes(label)}
                onClick={() => toggleLabelFilter(label)}
              >
                {label}
              </Pill>
            ))}
            {filtered ? (
              <button
                type="button"
                onClick={clearFilters}
                className="eyebrow ml-2 text-muted transition-colors hover:text-ink"
              >
                清除筛选
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className={cx(quiet ? "mt-12" : "mt-10")}>
        {view === "gantt" ? <Gantt /> : <Agenda />}
      </div>

      {quiet ? (
        <div className="mt-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setFocus("all")}
            className="eyebrow rounded-full border border-rule px-4 py-2 text-muted transition-colors hover:border-ink hover:text-ink"
          >
            退出专注
          </button>
          <button
            type="button"
            onClick={() => {
              setSection("projects");
              if (todos[0]) selectProject(todos[0].projectId);
            }}
            className="eyebrow text-faint transition-colors hover:text-ink"
          >
            打开 {projectById(todos[0]?.projectId ?? activeProjectId)?.name ?? "项目"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
