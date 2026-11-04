// PROTOTYPE, wipe me. ADHD mode, opened from the island. Pick one project and one task, then the
// screen becomes a Microscope-style single thread with that task's owning agent, the right panel
// kept and the left sidebar covered, until it is done. Task status lives in the island.
import { CheckIcon, CoffeeIcon } from "lucide-react";
import { useState } from "react";

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
import {
  DemoBar,
  ThreadScroller,
  useAdhdTask,
  useNextTasks,
  useTaskAgent,
  useTaskThread,
  useViewerAndProjects,
} from "./AdhdParts";
import { leaveAdhd, projectName, recommend, startAdhd, useAdhd } from "./adhdStore";
import { ChatComposerCard, type ChatMessage } from "./LighthouseChat";
import { useAllTasks } from "./lighthouseActions";
import { TASK_PRIORITY, TASK_STATUS, type LighthouseTask } from "./lighthouseData";
import { LighthousePanel } from "./LighthousePanel";

function AdhdPicker() {
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
        if (!open) leaveAdhd();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ADHD 模式</DialogTitle>
          <DialogDescription>
            只选一个项目和一个任务。开始后屏幕上只剩这个任务的对话，直到你完成它。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">1. 选一个项目</h3>
              <div role="radiogroup" aria-label="项目" className="flex flex-wrap gap-2">
                {projects.map((id) => (
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
                    <span className="text-xs tabular-nums">
                      {recommend(tasks, [id]).length} 个待办
                    </span>
                  </button>
                ))}
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
          <Button variant="outline" onClick={leaveAdhd}>
            取消
          </Button>
          <Button
            disabled={!project || !task}
            onClick={() => {
              if (project && task) startAdhd(project, task.id);
            }}
          >
            开始
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
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

function AdhdSession({ task, done }: { task: LighthouseTask; done: boolean }) {
  const { viewer, workspace } = useViewerAndProjects();
  const agent = useTaskAgent(task);
  const thread = useTaskThread(task, agent.name);
  const doneMessage = useDoneMessage(agent.name);
  return (
    <LighthousePanel viewer={viewer} workspace={workspace} view="chats" mainChat={agent.id}>
      <header className="flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center px-5 text-sm text-muted-foreground">
        ADHD 模式 · {projectName(task.project)}
      </header>
      {/* The top padding keeps the first messages clear of popups dropping from the island. */}
      <ThreadScroller
        messages={done ? [...thread.messages, doneMessage] : thread.messages}
        className="pt-24 pb-6"
      />
      <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 pb-4">
        {done ? (
          <Button variant="outline" onClick={leaveAdhd}>
            <CoffeeIcon />
            休息一下
          </Button>
        ) : (
          <ChatComposerCard placeholder={`对 ${agent.name} 说`} onSend={thread.send} autoFocus />
        )}
      </div>
    </LighthousePanel>
  );
}

export function AdhdMode() {
  const adhd = useAdhd();
  const current = useAdhdTask();
  if (adhd.phase === "pick") return <AdhdPicker />;
  if (!current) return null;
  // Not modal: the island, which carries the task status, sits outside this subtree.
  return (
    <div
      role="region"
      aria-label="ADHD 模式"
      className="fixed inset-0 z-60 flex flex-col bg-background"
    >
      <AdhdSession key={current.task.id} task={current.task} done={current.done} />
      {current.done ? null : <DemoBar />}
    </div>
  );
}
