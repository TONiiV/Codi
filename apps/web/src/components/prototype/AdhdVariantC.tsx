// PROTOTYPE, wipe me. ADHD mode, variant C "任务收进标题": the task's context (agent, tickets,
// priority, due date) is folded into one header card that opens on demand. Popups drop out from
// under the card's right edge, below the trophy; the finish step turns the card green.
import { CheckIcon, ChevronDownIcon, CircleDotIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  AchievementsButton,
  ThreadScroller,
  ToastStack,
  useNextTasks,
  type AdhdVariantProps,
} from "./AdhdParts";
import { leaveAdhd, projectName, startAdhd } from "./adhdStore";
import { ChatComposerCard } from "./LighthouseChat";
import { TASK_PRIORITY } from "./lighthouseData";

const TICKET_ICON = {
  open: CircleDotIcon,
  pr: PullRequestGlyph.pullRequest,
  merged: CheckIcon,
} as const;
const TICKET_LABEL = { open: "进行中", pr: "PR 待合并", merged: "已合并" } as const;

function TaskCard({ task, agent, done, onFinish }: Omit<AdhdVariantProps, "thread">) {
  const [open, setOpen] = useState(false);
  const merged = task.tickets.filter((t) => t.state === "merged").length;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-sm",
        done && "border-success/40 bg-success/8",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {done ? (
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-success/16 text-success-foreground motion-safe:animate-adhd-pop-in">
            <CheckIcon className="size-4" />
          </span>
        ) : (
          <span className={cn("size-2.5 shrink-0 rounded-full", agent.tone)} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-2xs text-muted-foreground">
            {done ? "已完成" : "ADHD 模式"} · {projectName(task.project)} · {agent.name}
          </span>
          <h1 className="truncate font-medium">{task.title}</h1>
        </div>
        {task.tickets.length > 0 && !done ? (
          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            工单 {merged}/{task.tickets.length}
          </span>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-expanded={open}
          aria-label={open ? "收起任务详情" : "展开任务详情"}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
        </Button>
        <AchievementsButton trigger={<Button size="icon-sm" variant="ghost-muted" />} />
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
      {open ? (
        <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{task.id}</span>
            {task.priority ? (
              <Badge size="sm" variant={TASK_PRIORITY[task.priority].badge}>
                {TASK_PRIORITY[task.priority].label}
              </Badge>
            ) : null}
            {task.due ? <span>截止 {task.due}</span> : null}
          </div>
          {task.description ? <p>{task.description}</p> : null}
          {task.tickets.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {task.tickets.map((t) => {
                const Icon = TICKET_ICON[t.state];
                return (
                  <li key={t.id} className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        t.state === "merged" ? "text-success" : "text-muted-foreground",
                      )}
                    />
                    <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {TICKET_LABEL[t.state]}
                      {t.worker ? ` · ${t.worker}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DoneC() {
  const { next } = useNextTasks();
  return (
    <section aria-label="下一个推荐任务" className="flex flex-col gap-3 pt-8">
      <h2 className="text-sm font-medium">接下来只做哪一个？</h2>
      {next.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有待办的任务了。</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {next.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => startAdhd(t.project, t.id)}
              className={cn(
                "flex flex-col gap-2 rounded-xl border bg-card p-4 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                i === 0 && "border-primary",
              )}
            >
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {projectName(t.project)}
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
              </span>
              <span className="font-medium">{t.title}</span>
              {t.description ? (
                <span className="line-clamp-2 text-xs text-muted-foreground">{t.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <div>
        <Button size="sm" variant="outline" onClick={leaveAdhd}>
          休息一下
        </Button>
      </div>
    </section>
  );
}

export function AdhdVariantC({ task, agent, thread, done, onFinish }: AdhdVariantProps) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4">
      <header className="relative shrink-0 pt-4">
        <TaskCard task={task} agent={agent} done={done} onFinish={onFinish} />
        <ToastStack from="0 -12px" className="absolute top-full right-3 z-10 mt-2 items-end" />
      </header>
      {done ? (
        <DoneC />
      ) : (
        <>
          <ThreadScroller messages={thread.messages} className="px-2 pt-6" />
          <div className="shrink-0 pt-2 pb-8">
            <ChatComposerCard placeholder={`对 ${agent.name} 说`} onSend={thread.send} autoFocus />
          </div>
        </>
      )}
    </div>
  );
}
