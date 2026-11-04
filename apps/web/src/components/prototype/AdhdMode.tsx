// PROTOTYPE, wipe me. ADHD mode, opened from the island. Pick one project and one task, then the
// whole screen is that task's thread with its owning agent until it is done. Three layouts are
// on trial behind the 演示 switch (?adhd=a|b|c).
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
import { AdhdVariantA } from "./AdhdVariantA";
import { AdhdVariantB } from "./AdhdVariantB";
import { AdhdVariantC } from "./AdhdVariantC";
import {
  DemoBar,
  useFinishTask,
  useTaskAgent,
  useTaskThread,
  useViewerAndProjects,
} from "./AdhdParts";
import {
  leaveAdhd,
  projectName,
  recommend,
  startAdhd,
  useAdhd,
  type AdhdVariant,
} from "./adhdStore";
import { useAllTasks } from "./lighthouseActions";
import { TASK_PRIORITY, TASK_STATUS, type LighthouseTask } from "./lighthouseData";

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

const VARIANTS = { a: AdhdVariantA, b: AdhdVariantB, c: AdhdVariantC };

/** Holds the thread above the variant, so switching layouts keeps the conversation. */
function AdhdSession({
  task,
  done,
  variant,
}: {
  task: LighthouseTask;
  done: boolean;
  variant: AdhdVariant;
}) {
  const agent = useTaskAgent(task);
  const thread = useTaskThread(task, agent.name);
  const onFinish = useFinishTask(task, agent);
  const Variant = VARIANTS[variant];
  return <Variant task={task} agent={agent} thread={thread} done={done} onFinish={onFinish} />;
}

export function AdhdMode() {
  const adhd = useAdhd();
  const tasks = useAllTasks();
  if (adhd.phase === "idle") return null;
  if (adhd.phase === "pick") return <AdhdPicker />;
  const task = tasks.find((t) => t.id === (adhd.phase === "adhd" ? adhd.task : adhd.finished));
  if (!task) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ADHD 模式"
      className="fixed inset-0 z-60 flex flex-col bg-background"
    >
      <AdhdSession key={task.id} task={task} done={adhd.phase === "next"} variant={adhd.variant} />
      <DemoBar />
    </div>
  );
}
