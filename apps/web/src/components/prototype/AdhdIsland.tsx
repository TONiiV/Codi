// PROTOTYPE, wipe me. During an ADHD mode session the top-centre island carries the task status.
// Resting, it is a small capsule with progress toward the next real milestone; on hover or
// keyboard focus it morphs open like the mode switcher. Popups drop out from under it.
import { CheckIcon } from "lucide-react";
import { useState, type FocusEvent } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  AchievementsButton,
  ToastStack,
  useFinishTask,
  useTaskAgent,
  useAdhdTask,
} from "./AdhdParts";
import { formatLeft, leaveAdhd, nextMilestone, useAdhd } from "./adhdStore";
import type { LighthouseTask } from "./lighthouseData";

/** Redrawn when the store commits, which is once a minute or on a popup: never in between. */
function ProgressRing({ share }: { share: number }) {
  const r = 6;
  const around = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={around}
        strokeDashoffset={around * (1 - Math.min(1, Math.max(0.04, share)))}
        className="stroke-primary"
      />
    </svg>
  );
}

function Resting({ done }: { done: boolean }) {
  const next = nextMilestone(useAdhd());
  if (done) {
    return (
      <>
        <CheckIcon className="size-3.5 shrink-0 text-success" />
        <span>已完成 · 选下一个任务</span>
      </>
    );
  }
  if (!next) return <span>两条成就都已达成</span>;
  return (
    <>
      <ProgressRing share={next.share} />
      <span className="truncate tabular-nums">
        距 {next.label} 还有 {formatLeft(next.left)}
      </span>
    </>
  );
}

function TaskIsland({ task, done }: { task: LighthouseTask; done: boolean }) {
  const agent = useTaskAgent(task);
  const onFinish = useFinishTask(task, agent);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focused || pinned;
  const merged = task.tickets.filter((t) => t.state === "merged").length;
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
  };
  return (
    <div
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlur={onBlur}
      className="fixed top-(--workspace-controls-top) left-1/2 z-70 flex h-(--workspace-topbar-height) w-156 -translate-x-1/2 items-center justify-center [-webkit-app-region:no-drag]"
    >
      <div
        role="group"
        aria-label={`ADHD 模式：${task.title}`}
        className={cn(
          "relative flex items-center justify-center overflow-hidden border shadow-sm",
          "transition-[width,height,border-radius,background-color,box-shadow] duration-300 ease-out motion-reduce:transition-none",
          open
            ? "h-11 w-148 rounded-2xl border-border bg-popover/90 shadow-xl backdrop-blur-xl"
            : "h-7 w-64 rounded-full border-border/70 bg-popover/85 backdrop-blur-md",
        )}
      >
        <span
          aria-hidden={open}
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-1.5 px-3 text-xs transition-[opacity,scale] duration-200 motion-reduce:transition-none",
            open ? "scale-90 opacity-0" : "opacity-100",
          )}
        >
          <Resting done={done} />
        </span>
        <div
          className={cn(
            "relative flex h-9 w-146 shrink-0 items-center gap-2 pr-1 pl-3 transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none",
            open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
          )}
        >
          <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", agent.tone)} />
            {agent.name}
          </span>
          {task.tickets.length > 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              工单 {merged}/{task.tickets.length}
            </span>
          ) : null}
          <AchievementsButton
            align="center"
            onOpenChange={setPinned}
            trigger={<Button size="icon-sm" variant="ghost-muted" />}
          />
          <Button size="sm" variant="ghost-muted" onClick={leaveAdhd}>
            退出
          </Button>
          {done ? null : (
            <Button size="sm" onClick={onFinish}>
              <CheckIcon />
              完成任务
            </Button>
          )}
        </div>
      </div>
      {/* Anchored just under the resting capsule, so each popup drops out of it. */}
      <ToastStack
        from="0 -14px"
        className="absolute top-1/2 left-1/2 mt-5 w-max -translate-x-1/2 items-center"
      />
    </div>
  );
}

/** Replaces the mode switcher while a session is on; null otherwise. */
export function AdhdIsland() {
  const current = useAdhdTask();
  return current ? <TaskIsland key={current.task.id} {...current} /> : null;
}
