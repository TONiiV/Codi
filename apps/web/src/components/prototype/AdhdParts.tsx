// PROTOTYPE, wipe me. ADHD mode pieces: the task thread with its owning agent, the short-lived
// milestone and achievement popups, the achievements popover, the next-task list and the 演示 bar.
import { FastForwardIcon, SparklesIcon, TrophyIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactElement } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  finishAdhdTask,
  SESSION_ACHIEVEMENTS,
  TOTAL_ACHIEVEMENTS,
  achievementProgress,
  formatDuration,
  recommend,
  skipFiveMinutes,
  useAdhd,
  type AdhdToast,
} from "./adhdStore";
import { ChatTimeline, type ChatMessage } from "./LighthouseChat";
import { moveTask, taskAgent, useAllTasks, useRegistryVersion } from "./lighthouseActions";
import {
  PROJECT_COS,
  chatsFor,
  chiefName,
  projectsIn,
  type LighthouseTask,
  type LighthouseViewer,
} from "./lighthouseData";
import { useLighthouseSearch } from "./lighthouseLocation";
import { useWorkspaceId } from "./workspaceStore";

export function useViewerAndProjects() {
  const viewer: LighthouseViewer = useLighthouseSearch()?.as ?? "admin";
  const workspace = useWorkspaceId();
  return { viewer, workspace, projects: projectsIn(workspace, viewer).open };
}

// The version argument keeps the React Compiler from caching names read from module data.
function agentFor(
  task: LighthouseTask,
  viewer: LighthouseViewer,
  workspace: string,
  _version: number,
) {
  const id = taskAgent(task, viewer, workspace);
  const chat = chatsFor(viewer, workspace).find((c) => c.id === id);
  return {
    id,
    name: chat?.name ?? chiefName(viewer, task.project),
    tone: chat?.tone ?? PROJECT_COS[task.project]?.tone ?? "bg-primary",
  };
}

export function useTaskAgent(task: LighthouseTask) {
  const { viewer, workspace } = useViewerAndProjects();
  return agentFor(task, viewer, workspace, useRegistryVersion());
}

export type TaskAgent = ReturnType<typeof useTaskAgent>;

function openingFor(task: LighthouseTask, agent: string): ReadonlyArray<ChatMessage> {
  const open = task.tickets.filter((t) => t.state !== "merged");
  const first = open.find((t) => t.state === "open") ?? open[0];
  return [
    { id: "u-open", role: "user", body: `ADHD 模式：现在只做「${task.title}」。` },
    {
      id: "a-open",
      role: "assistant",
      author: agent,
      body: (
        <>
          <p>
            好，其他项目的消息我先替你挡住，这里只聊这一件。
            {task.description ? ` ${task.description}` : ""}
          </p>
          {task.tickets.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-xs">
              {task.tickets.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="text-muted-foreground">
                    {t.state === "merged" ? "已合并" : t.state === "pr" ? "PR 待合并" : "进行中"}
                    {t.worker ? ` · ${t.worker}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2">
            {first
              ? `建议先从 ${first.id}「${first.title}」开始。要我做什么，直接说。`
              : "还没有工单。先说说第一步想做什么，我来开工单。"}
          </p>
        </>
      ),
    },
  ];
}

function replyFor(task: LighthouseTask, n: number): string {
  const ticket = task.tickets.find((t) => t.state !== "merged");
  const replies = [
    `收到，记在 ${task.id} 下面了${ticket?.worker ? `，也转给了 ${ticket.worker}` : ""}。你接着做手上的。`,
    "好，这一步我来盯。别切出去，有结果我就在这里说。",
    `明白。${ticket ? `${ticket.id} 我先推一把，` : ""}卡住了我会直接问你。`,
  ];
  return replies[n % replies.length]!;
}

/** The one conversation ADHD mode shows: the task's owning agent, with mock replies. */
export function useTaskThread(task: LighthouseTask, agent: string) {
  const [opening] = useState(() => openingFor(task, agent));
  const [log, setLog] = useState<ReadonlyArray<ChatMessage>>([]);
  const send = (text: string) => {
    const n = log.length;
    setLog((l) => [...l, { id: `u${n}`, role: "user", body: text }]);
    window.setTimeout(
      () =>
        setLog((l) => [
          ...l,
          {
            id: `a${n}`,
            role: "assistant",
            author: agent,
            body: replyFor(task, Math.floor(n / 2)),
          },
        ]),
      700,
    );
  };
  return { messages: [...opening, ...log], send };
}

export function ThreadScroller({
  messages,
  className,
}: {
  messages: ReadonlyArray<ChatMessage>;
  className?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
      <div className={cn("mx-auto w-full max-w-(--chat-content-max-width) px-5", className)}>
        <ChatTimeline messages={messages} />
        {/* Keyed by count, so each new message remounts it and scrolls the thread down. */}
        <div key={messages.length} ref={(el) => el?.scrollIntoView({ block: "end" })} />
      </div>
    </div>
  );
}

function Medal({
  track,
  short,
  unlocked,
  fresh,
  large,
}: {
  track: "session" | "total";
  short: string;
  unlocked: boolean;
  fresh?: boolean;
  large?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border-2 font-semibold tabular-nums",
        large ? "size-12 text-sm" : "size-9 text-xs",
        track === "total" ? "rounded-full" : "rounded-xl",
        unlocked
          ? track === "total"
            ? "border-primary bg-primary text-primary-foreground shadow-md"
            : "border-foreground bg-foreground text-background shadow-md"
          : "border-dashed border-border text-muted-foreground",
        fresh && "motion-safe:animate-adhd-unlock",
      )}
    >
      {short}
      {fresh ? (
        <span className="absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/60 to-transparent motion-safe:animate-adhd-shine" />
      ) : null}
    </span>
  );
}

/** One popup. Plain 5-minute ones are a slim pill; achievements are a larger card with a medal. */
function ToastCard({ toast, from }: { toast: AdhdToast; from: string }) {
  const style = {
    "--adhd-from": from,
    animationDuration: toast.kind === "milestone" ? "4s" : "5.2s",
  } as CSSProperties;
  const motion = "motion-safe:animate-adhd-toast motion-reduce:animate-adhd-fade";
  if (toast.kind === "milestone") {
    return (
      <div
        style={style}
        className={cn(
          "flex w-fit items-center gap-2 rounded-full border bg-popover px-3 py-1.5 text-sm whitespace-nowrap shadow-lg",
          motion,
        )}
      >
        <span className="size-2 rounded-full bg-primary" />
        <span className="font-medium">又专注了 5 分钟</span>
        <span className="text-muted-foreground tabular-nums">这次已经 {toast.minutes} 分钟</span>
      </div>
    );
  }
  const session = toast.kind === "session";
  return (
    <div
      style={style}
      className={cn(
        "flex w-80 items-center gap-3 rounded-2xl border-2 bg-popover px-4 py-3 shadow-xl",
        session ? "border-foreground/80" : "border-primary",
        motion,
      )}
    >
      <Medal
        track={toast.kind}
        short={session ? `${toast.minutes}′` : `${toast.hours}h`}
        unlocked
        fresh
        large
      />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <SparklesIcon className="size-3.5" />
          成就解锁 · {session ? "单次连续" : "累计时长"}
        </span>
        <span className="text-base font-semibold">{toast.label}</span>
        <span className="text-xs text-muted-foreground">
          {session ? "一口气没切出去，记进了最长纪录。" : "所有 ADHD 模式时间加起来。"}
        </span>
      </div>
    </div>
  );
}

/**
 * The popups live in a polite live region with nothing focusable, so they never take focus from
 * the composer. The caller positions the stack and says which way a popup slides in.
 */
export function ToastStack({ className, from }: { className?: string; from: string }) {
  const { toasts } = useAdhd();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("pointer-events-none flex flex-col gap-2", className)}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} from={from} />
      ))}
    </div>
  );
}

function Track({
  title,
  items,
  value,
  track,
  note,
}: {
  title: string;
  items: typeof TOTAL_ACHIEVEMENTS;
  value: number;
  track: "session" | "total";
  note: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="flex items-start justify-between gap-2">
        {items.map((a) => (
          <div key={a.key} className="flex w-14 flex-col items-center gap-1">
            <Medal track={track} short={a.short} unlocked={value >= a.ms} />
            <span className="text-2xs whitespace-nowrap text-muted-foreground">{a.caption}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{note}</p>
    </section>
  );
}

function AchievementTracks() {
  const { total, best, session } = achievementProgress(useAdhd());
  const nextTotal = TOTAL_ACHIEVEMENTS.find((a) => total < a.ms);
  const nextSession = SESSION_ACHIEVEMENTS.find((a) => session < a.ms);
  return (
    <div className="flex w-76 flex-col gap-4 text-sm">
      <Track
        title="累计时长"
        items={TOTAL_ACHIEVEMENTS}
        value={total}
        track="total"
        note={`共 ${formatDuration(total)}${nextTotal ? `，离「${nextTotal.label}」还差 ${formatDuration(nextTotal.ms - total)}` : "，全部达成"}`}
      />
      <Track
        title="单次连续"
        items={SESSION_ACHIEVEMENTS}
        value={best}
        track="session"
        note={`这次 ${formatDuration(session)} · 最长一次 ${formatDuration(best)}${nextSession ? ` · 再坚持 ${formatDuration(nextSession.ms - session)} 解锁「${nextSession.label}」` : ""}`}
      />
    </div>
  );
}

/** Closed by default: nothing about time is on screen until it is asked for. */
export function AchievementsButton({
  trigger,
  side = "bottom",
  align = "end",
  onOpenChange,
}: {
  trigger: ReactElement;
  side?: "bottom" | "top" | "right";
  align?: "start" | "end" | "center";
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover {...(onOpenChange ? { onOpenChange } : {})}>
      <PopoverTrigger aria-label="成就" render={trigger}>
        <TrophyIcon />
      </PopoverTrigger>
      <PopoverPopup side={side} align={align} aria-label="ADHD 模式成就">
        <AchievementTracks />
      </PopoverPopup>
    </Popover>
  );
}

/** The task on screen: the one in progress, or the one just finished while picking the next. */
export function useAdhdTask() {
  const adhd = useAdhd();
  const tasks = useAllTasks();
  if (adhd.phase !== "adhd" && adhd.phase !== "next") return null;
  const id = adhd.phase === "adhd" ? adhd.task : adhd.finished;
  const task = tasks.find((t) => t.id === id);
  return task ? { task, done: adhd.phase === "next" } : null;
}

/** Same project first, then the rest; the first one is the recommendation. */
export function useNextTasks(limit = 4) {
  const adhd = useAdhd();
  const { projects } = useViewerAndProjects();
  const tasks = useAllTasks();
  const same = adhd.project ? recommend(tasks, [adhd.project]) : [];
  const others = recommend(
    tasks,
    projects.filter((p) => p !== adhd.project),
  );
  return {
    done: tasks.find((t) => t.id === adhd.finished),
    next: [...same, ...others].slice(0, limit),
  };
}

/** Prototype only: fast-forward so the milestones can be shown, kept small and out of the way. */
export function DemoBar() {
  return (
    <div className="fixed bottom-3 left-3 flex items-center gap-1 rounded-lg border border-dashed bg-background/90 p-1 text-xs text-muted-foreground">
      <span className="px-1.5">演示</span>
      <Button size="xs" variant="ghost-muted" onClick={skipFiveMinutes}>
        <FastForwardIcon />
        快进 5 分钟
      </Button>
    </div>
  );
}

export function useFinishTask(task: LighthouseTask, agent: TaskAgent) {
  const { viewer } = useViewerAndProjects();
  return () => {
    moveTask(task, "done", agent.id, viewer);
    finishAdhdTask();
  };
}
