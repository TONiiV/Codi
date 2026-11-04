// PROTOTYPE, wipe me. ADHD mode, variant A "安静单栏": one narrow centred column and nothing else.
// The header is a whisper (task title, 退出, 完成任务); popups drop in at the top centre.
import { CheckIcon, LogOutIcon } from "lucide-react";

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

function DoneA() {
  const { done, next } = useNextTasks();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-16">
      <div className="flex flex-col items-center gap-2 text-center motion-safe:animate-adhd-pop-in">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon className="size-6" />
        </span>
        <h2 className="text-xl font-semibold">完成了</h2>
        {done ? <p className="text-sm text-muted-foreground">{done.title}</p> : null}
      </div>
      <section aria-label="下一个推荐任务" className="flex w-full flex-col gap-1">
        <h3 className="px-3 pb-1 text-xs text-muted-foreground">接下来只做哪一个？</h3>
        {next.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">没有待办的任务了。</p>
        ) : (
          next.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => startAdhd(t.project, t.id)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
      </section>
      <Button size="sm" variant="outline" onClick={leaveAdhd}>
        休息一下
      </Button>
    </div>
  );
}

export function AdhdVariantA({ task, agent, thread, done, onFinish }: AdhdVariantProps) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Button size="sm" variant="ghost-muted" onClick={leaveAdhd}>
          <LogOutIcon />
          退出
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <span className="text-2xs text-muted-foreground">ADHD 模式 · {agent.name}</span>
          <h1 className="max-w-full truncate text-sm font-medium">{task.title}</h1>
        </div>
        <AchievementsButton trigger={<Button size="icon-sm" variant="ghost-muted" />} />
        {done ? null : (
          <Button size="sm" variant="outline" onClick={onFinish}>
            <CheckIcon />
            完成任务
          </Button>
        )}
      </header>
      <ToastStack
        from="0 -10px"
        className="absolute top-16 left-1/2 z-10 -translate-x-1/2 items-center"
      />
      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-6">
        {done ? (
          <DoneA />
        ) : (
          <>
            <ThreadScroller messages={thread.messages} className="pt-8" />
            <div className="shrink-0 pt-2 pb-8">
              <ChatComposerCard
                placeholder={`对 ${agent.name} 说`}
                onSend={thread.send}
                autoFocus
              />
            </div>
          </>
        )}
      </main>
    </>
  );
}
