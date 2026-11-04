// PROTOTYPE, wipe me. ADHD mode, variant B "边缘进度": a slim rail on the left edge fills once a
// minute toward the 90-minute mark, with the single-session achievements notched on it. Popups
// slide out of the rail at the current mark; the thread runs wide and left-aligned beside it.
import { CheckIcon, CoffeeIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  AchievementsButton,
  ThreadScroller,
  ToastStack,
  useNextTasks,
  type AdhdVariantProps,
} from "./AdhdParts";
import {
  SESSION_ACHIEVEMENTS,
  leaveAdhd,
  projectName,
  startAdhd,
  useSessionMinutes,
} from "./adhdStore";
import { ChatComposerCard, type ChatMessage } from "./LighthouseChat";

const RAIL_MINUTES = 90;
const TICKS = Array.from({ length: RAIL_MINUTES / 5 + 1 }, (_, i) => i * 5);
const pct = (minutes: number) => `${(Math.min(minutes, RAIL_MINUTES) / RAIL_MINUTES) * 100}%`;

/** Re-renders once a minute; no transition, so nothing repaints between minutes. */
function SessionRail() {
  const minutes = useSessionMinutes();
  return (
    <div className="relative mx-auto w-10 flex-1">
      <div aria-hidden="true" className="absolute inset-0">
        <span className="absolute inset-y-0 right-2 w-0.5 rounded-full bg-border" />
        <span
          className="absolute top-0 right-2 w-0.5 rounded-full bg-primary"
          style={{ height: pct(minutes) }}
        />
        {TICKS.map((m) => {
          const mark = SESSION_ACHIEVEMENTS.find((a) => a.ms === m * 60_000);
          return (
            <span
              key={m}
              style={{ top: pct(m) }}
              className="absolute right-2 flex -translate-y-1/2 translate-x-1/2 items-center"
            >
              {mark ? (
                <>
                  <span
                    className={cn(
                      "absolute right-3 text-2xs tabular-nums",
                      minutes >= m ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {mark.short}
                  </span>
                  <span
                    className={cn(
                      "size-2.5 rounded-sm border-2",
                      minutes >= m
                        ? "border-foreground bg-foreground"
                        : "border-border bg-background",
                    )}
                  />
                </>
              ) : (
                <span
                  className={cn("size-1 rounded-full", minutes >= m ? "bg-primary" : "bg-border")}
                />
              )}
            </span>
          );
        })}
        <span
          style={{ top: pct(minutes) }}
          className="absolute right-2 size-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-4 ring-primary/20"
        />
      </div>
      <ToastStack
        from="-12px 0"
        style={{ top: pct(minutes) }}
        className="absolute left-full z-10 ml-4 w-max -translate-y-1/2"
      />
    </div>
  );
}

function useDoneMessage(agent: string): ChatMessage {
  const { done, next } = useNextTasks();
  return {
    id: "a-done",
    role: "assistant",
    author: agent,
    body: (
      <div className="flex flex-col gap-2">
        <p>
          <CheckIcon className="me-1 inline size-4 text-success" />
          搞定，{done ? `「${done.title}」` : "这个任务"}已经标成完成。下一件只挑一个：
        </p>
        <div aria-label="下一个推荐任务" className="flex flex-col divide-y rounded-lg border">
          {next.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground">没有待办的任务了。</p>
          ) : (
            next.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onClick={() => startAdhd(t.project, t.id)}
                className="flex items-center gap-3 px-3 py-2 text-left outline-none transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
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
        </div>
      </div>
    ),
  };
}

export function AdhdVariantB({ task, agent, thread, done, onFinish }: AdhdVariantProps) {
  const doneMessage = useDoneMessage(agent.name);
  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="本次进度"
        className="flex w-16 shrink-0 flex-col items-center gap-3 border-r pt-16 pb-14"
      >
        <SessionRail />
        <AchievementsButton
          side="right"
          align="end"
          trigger={<Button size="icon-sm" variant="ghost-muted" />}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-8">
          <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</h1>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", agent.tone)} />
            {agent.name}
          </span>
          <Button size="sm" variant="ghost-muted" onClick={leaveAdhd}>
            退出
          </Button>
          {done ? null : (
            <Button size="sm" onClick={onFinish}>
              <CheckIcon />
              完成任务
            </Button>
          )}
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-10">
          <ThreadScroller
            messages={done ? [...thread.messages, doneMessage] : thread.messages}
            className="pt-6"
          />
          <div className="shrink-0 pt-2 pb-8">
            {done ? (
              <Button variant="outline" onClick={leaveAdhd}>
                <CoffeeIcon />
                休息一下
              </Button>
            ) : (
              <ChatComposerCard
                placeholder={`对 ${agent.name} 说`}
                onSend={thread.send}
                autoFocus
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
