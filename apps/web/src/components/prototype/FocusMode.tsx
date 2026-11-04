// PROTOTYPE, wipe me. Focus mode, opened from the island. Pick one project and one task, then a
// full-screen page shows only that task and a timer until it is done. Every 5 minutes a one-shot
// burst plays; total focus time unlocks the 1h / 10h / 50h / 100h achievements.
import { CheckIcon, FastForwardIcon, LogOutIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
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
import { moveTask, useAllTasks } from "./lighthouseActions";
import { TASK_PRIORITY, TASK_STATUS, projectsIn, type LighthouseViewer } from "./lighthouseData";
import { useLighthouseSearch } from "./lighthouseLocation";
import {
  ACHIEVEMENTS,
  FIVE_MINUTES,
  finishFocusTask,
  formatClock,
  formatDuration,
  leaveFocus,
  markAchievementSeen,
  projectName,
  recommend,
  sessionElapsed,
  skipFiveMinutes,
  startFocus,
  useFocus,
} from "./focusStore";
import { useWorkspaceId } from "./workspaceStore";

function useViewerAndProjects() {
  const viewer: LighthouseViewer = useLighthouseSearch()?.as ?? "admin";
  const workspace = useWorkspaceId();
  return { viewer, projects: projectsIn(workspace, viewer).open };
}

function FocusPicker() {
  const { projects } = useViewerAndProjects();
  const tasks = useAllTasks();
  const [project, setProject] = useState(projects[0] ?? null);
  const options = project ? recommend(tasks, [project]) : [];
  const [picked, setPicked] = useState<string | null>(null);
  const task = options.find((t) => t.id === picked) ?? options[0];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) leaveFocus();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>专注模式</DialogTitle>
          <DialogDescription>
            只选一个项目和一个任务。开始后，其他信息都会隐藏，直到你完成这个任务。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">1. 选一个项目</h3>
              <div role="radiogroup" aria-label="项目" className="flex flex-wrap gap-2">
                {projects.map((id) => {
                  const open = recommend(tasks, [id]).length;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={id === project}
                      onClick={() => {
                        setProject(id);
                        setPicked(null);
                      }}
                      className={cn(
                        "flex items-baseline gap-2 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        id === project
                          ? "border-primary bg-primary/8 text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span className="font-medium">{projectName(id)}</span>
                      <span className="text-xs tabular-nums">{open} 个待办</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">2. 选一个任务开始</h3>
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground">这个项目没有待办的任务。</p>
              ) : (
                <div role="radiogroup" aria-label="任务" className="flex flex-col gap-1.5">
                  {options.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={t.id === task?.id}
                      onClick={() => setPicked(t.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        t.id === task?.id ? "border-primary bg-primary/8" : "hover:bg-accent",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {i === 0 ? (
                        <Badge size="sm" variant="success">
                          推荐
                        </Badge>
                      ) : null}
                      {t.priority ? (
                        <Badge size="sm" variant={TASK_PRIORITY[t.priority].badge}>
                          {TASK_PRIORITY[t.priority].label}
                        </Badge>
                      ) : null}
                      <Badge size="sm" variant={TASK_STATUS[t.status].badge}>
                        {TASK_STATUS[t.status].label}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={leaveFocus}>
            取消
          </Button>
          <Button
            disabled={!project || !task}
            onClick={() => {
              if (project && task) startFocus(project, task.id);
            }}
          >
            开始专注
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the timer follows the wall clock
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

const RAYS = Array.from({ length: 12 }, (_, i) => i * 30);

/** One-shot celebration for each finished 5-minute block. Remounted by key, so it replays. */
function FiveMinuteBurst({ blocks }: { blocks: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute inset-0 rounded-full border-2 border-primary opacity-0 motion-safe:animate-focus-shock" />
      <span
        style={{ animationDelay: "160ms" }}
        className="absolute inset-0 rounded-full border border-primary/60 opacity-0 motion-safe:animate-focus-shock"
      />
      {RAYS.map((deg) => (
        <span
          key={deg}
          style={{ rotate: `${deg}deg` }}
          className="absolute top-1/2 left-1/2 h-0.5 w-0 origin-left"
        >
          <span className="absolute left-30 h-0.5 w-4 rounded-full bg-primary opacity-0 motion-safe:animate-focus-ray" />
        </span>
      ))}
      <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium whitespace-nowrap text-primary-foreground opacity-0 shadow-lg motion-safe:animate-focus-pop motion-reduce:opacity-100">
        +5 分钟 · 已连续专注 {blocks * 5} 分钟
      </span>
    </div>
  );
}

function Medal({ hours, unlocked, fresh }: { hours: number; unlocked: boolean; fresh?: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-11 items-center justify-center overflow-hidden rounded-full border-2 text-xs font-semibold tabular-nums",
        unlocked
          ? "border-primary bg-primary text-primary-foreground shadow-md"
          : "border-dashed border-border text-muted-foreground",
        fresh && "motion-safe:animate-focus-unlock",
      )}
    >
      {hours}h
      {fresh ? (
        <span className="absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/60 to-transparent motion-safe:animate-focus-shine" />
      ) : null}
    </span>
  );
}

function Achievements({ total }: { total: number }) {
  const next = ACHIEVEMENTS.find((a) => total < a.ms);
  const prev = ACHIEVEMENTS.findLast((a) => total >= a.ms)?.ms ?? 0;
  const share = next ? (total - prev) / (next.ms - prev) : 1;
  return (
    <section aria-label="专注成就" className="flex w-full max-w-md flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        {ACHIEVEMENTS.map((a) => (
          <div key={a.hours} className="flex flex-col items-center gap-1">
            <Medal hours={a.hours} unlocked={total >= a.ms} />
            <span className="text-2xs text-muted-foreground">{a.label}</span>
          </div>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
      </div>
      <p className="text-center text-xs text-muted-foreground tabular-nums">
        累计专注 {formatDuration(total)}
        {next ? ` · 离「${next.label}」还差 ${formatDuration(next.ms - total)}` : " · 全部达成"}
      </p>
    </section>
  );
}

function AchievementUnlocked({ total }: { total: number }) {
  const { seen } = useFocus();
  const fresh = ACHIEVEMENTS.find((a) => total >= a.ms && !seen.includes(a.hours));
  if (!fresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-8 z-10 mx-auto flex w-fit items-center gap-3 rounded-2xl border bg-popover px-4 py-3 shadow-xl motion-safe:animate-focus-pop-in"
    >
      <Medal hours={fresh.hours} unlocked fresh />
      <div className="flex flex-col">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <SparklesIcon className="size-3.5" />
          成就达成
        </span>
        <span className="font-medium">{fresh.label}</span>
      </div>
      <Button size="sm" variant="outline" onClick={() => markAchievementSeen(fresh.hours)}>
        收下
      </Button>
    </div>
  );
}

function FocusSession() {
  const focus = useFocus();
  const { viewer } = useViewerAndProjects();
  const tasks = useAllTasks();
  const now = useNow(focus.phase === "focus");
  const elapsed = sessionElapsed(focus, now);
  const blocks = Math.floor(elapsed / FIVE_MINUTES);
  const inBlock = (elapsed % FIVE_MINUTES) / FIVE_MINUTES;
  const task = tasks.find((t) => t.id === focus.task);
  if (!task) return null;
  const r = 104;
  const around = 2 * Math.PI * r;
  return (
    <>
      <div className="relative size-60">
        <svg viewBox="0 0 240 240" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="120" cy="120" r={r} fill="none" strokeWidth="6" className="stroke-border" />
          <circle
            cx="120"
            cy="120"
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={around}
            strokeDashoffset={around * (1 - inBlock)}
            className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span
            key={blocks}
            className="text-5xl font-semibold tabular-nums motion-safe:animate-focus-flash"
            role="timer"
            aria-label="本次专注时长"
          >
            {formatClock(elapsed)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {blocks > 0 ? `已完成 ${blocks} 个 5 分钟` : "每 5 分钟一个小节"}
          </span>
        </div>
        {blocks > 0 ? <FiveMinuteBurst key={blocks} blocks={blocks} /> : null}
      </div>
      <div className="flex max-w-xl flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold text-balance">{task.title}</h1>
        {task.description ? (
          <p className="text-sm text-muted-foreground">{task.description}</p>
        ) : null}
        {task.tickets.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1 text-left text-sm">
            {task.tickets.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex size-4 items-center justify-center rounded-full border",
                    t.state === "merged" && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {t.state === "merged" ? <CheckIcon className="size-3" /> : null}
                </span>
                <span className="text-muted-foreground tabular-nums">{t.id}</span>
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="lg"
          onClick={() => {
            moveTask(task, "done", "mine", viewer);
            finishFocusTask();
          }}
        >
          <CheckIcon />
          完成任务
        </Button>
        <Button size="sm" variant="ghost-muted" onClick={skipFiveMinutes}>
          <FastForwardIcon />
          快进 5 分钟（演示）
        </Button>
      </div>
      <Achievements total={focus.total + elapsed} />
      <AchievementUnlocked total={focus.total + elapsed} />
    </>
  );
}

function NextTasks() {
  const focus = useFocus();
  const { projects } = useViewerAndProjects();
  const tasks = useAllTasks();
  const done = tasks.find((t) => t.id === focus.finished);
  const same = focus.project ? recommend(tasks, [focus.project]) : [];
  const others = recommend(
    tasks,
    projects.filter((p) => p !== focus.project),
  );
  const list = [...same, ...others].slice(0, 4);
  return (
    <>
      <div className="flex max-w-xl flex-col items-center gap-2 text-center motion-safe:animate-focus-pop-in">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <CheckIcon className="size-7" />
        </span>
        <h1 className="text-2xl font-semibold">完成了</h1>
        {done ? <p className="text-sm text-muted-foreground">{done.title}</p> : null}
      </div>
      <section
        aria-label="下一个推荐任务"
        className="flex w-full max-w-lg flex-col gap-2 rounded-2xl border bg-card p-4 shadow-lg motion-safe:animate-focus-pop-in"
        style={{ animationDelay: "180ms" }}
      >
        <h2 className="text-sm font-medium">接下来专注哪一个？</h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有待办的任务了。</p>
        ) : (
          list.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => startFocus(t.project, t.id)}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {projectName(t.project)}
              </span>
              {i === 0 ? (
                <Badge size="sm" variant="success">
                  推荐
                </Badge>
              ) : null}
            </button>
          ))
        )}
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="outline" onClick={leaveFocus}>
            休息一下
          </Button>
        </div>
      </section>
      <Achievements total={focus.total} />
      <AchievementUnlocked total={focus.total} />
    </>
  );
}

export function FocusMode() {
  const focus = useFocus();
  if (focus.phase === "idle") return null;
  if (focus.phase === "pick") return <FocusPicker />;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="专注模式"
      className="fixed inset-0 z-60 flex flex-col overflow-y-auto bg-background"
    >
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-muted-foreground">
          专注中 · <span className="font-medium text-foreground">{projectName(focus.project)}</span>
        </span>
        <Button size="sm" variant="ghost-muted" onClick={leaveFocus}>
          <LogOutIcon />
          退出专注
        </Button>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-12">
        {focus.phase === "focus" ? <FocusSession /> : <NextTasks />}
      </main>
    </div>
  );
}
