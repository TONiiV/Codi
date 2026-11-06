import {
  dashboardListCounts,
  type DashboardListCount,
} from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";
import { LayoutDashboardIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { RefreshIcon } from "../ui/refresh-icon";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";

const STATUS: Record<
  Telescope.OpenTaskStatus,
  { label: string; badge: "outline" | "secondary" | "info" | "warning" }
> = {
  todo: { label: "待办", badge: "outline" },
  in_progress: { label: "进行中", badge: "secondary" },
  in_review: { label: "评审中", badge: "info" },
  needs_decision: { label: "等你定", badge: "warning" },
};

const MINUTE = 60_000;
/** How long from `since` to `now`, rounded down to the largest unit that fits. */
function waited(since: string, now: string): string {
  const ms = Math.max(0, Date.parse(now) - Date.parse(since));
  if (ms < MINUTE) return "不到 1 分钟";
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)} 分钟`;
  if (ms < 48 * 60 * MINUTE) return `${Math.floor(ms / (60 * MINUTE))} 小时`;
  return `${Math.floor(ms / (24 * 60 * MINUTE))} 天`;
}

function Kpi({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: DashboardListCount;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <h3 className="px-4 py-2.5 text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">{count.total}</span>
      </h3>
      {children}
      {count.shown < count.total ? (
        <p className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
          只显示前 {count.shown} 个，共 {count.total} 个
        </p>
      ) : null}
    </section>
  );
}

function SummaryView({ summary }: { summary: Telescope.DashboardSummary }) {
  const now = summary.generatedAt;
  const { openTasks, tasks, runs, wakes } = summary;
  const counts = dashboardListCounts(summary);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="未完成任务"
          value={counts.tasks.total}
          detail={`进行中 ${openTasks.in_progress} · 评审中 ${openTasks.in_review}`}
        />
        <Kpi
          label="需要你定"
          value={summary.pendingDecisions}
          detail={`${openTasks.needs_decision} 个任务等决定`}
        />
        <Kpi
          label="运行中"
          value={counts.runs.total}
          detail={runs[0] ? `最久的已跑 ${waited(runs[0].startedAt, now)}` : "没有在跑的运行"}
        />
        <Kpi
          label="排队唤醒"
          value={wakes.queued}
          detail={
            wakes.oldestQueuedAt
              ? `最久的已等 ${waited(wakes.oldestQueuedAt, now)}`
              : `${wakes.running} 个正在运行`
          }
        />
      </div>
      <Section title="未完成任务 · 等得最久的在前" count={counts.tasks}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务</TableHead>
              <TableHead>卡在哪步</TableHead>
              <TableHead>谁手里</TableHead>
              <TableHead className="text-end">等了多久</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <span className="block max-w-80 truncate">{task.title}</span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1">
                    <Badge variant={STATUS[task.status].badge}>{STATUS[task.status].label}</Badge>
                    {task.conflictDecisionId ? <Badge variant="warning">有冲突</Badge> : null}
                  </span>
                </TableCell>
                <TableCell>
                  {task.holder ? (
                    <span>
                      {task.holder.name}
                      {task.holder.via === "lease" ? (
                        <span className="ms-1 text-muted-foreground">在做</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">没人接</span>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <span className="tabular-nums">{waited(task.statusSince, now)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
      <Section title="运行中" count={counts.runs}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>当前步骤</TableHead>
              <TableHead className="text-end">工具调用</TableHead>
              <TableHead className="text-end">已跑</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{run.agentName}</TableCell>
                <TableCell>
                  {run.step ? (
                    <span>
                      <span className="font-mono">{run.step.tool}</span>
                      <span className="ms-1 text-muted-foreground">
                        {waited(run.step.at, now)}前
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">还没调用工具</span>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <span className="tabular-nums">{run.calls}</span>
                </TableCell>
                <TableCell className="text-end">
                  <span className="tabular-nums">{waited(run.startedAt, now)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

function Notice({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutDashboardIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/** Where work waits in the current workspace. Refreshes on demand only; nothing polls. */
export function TelescopeDashboard() {
  const { environmentId, current } = useTelescopeWorkspaces();
  const query = useEnvironmentQuery(
    environmentId === null || current === null
      ? null
      : telescope.dashboard({ environmentId, input: { workspaceId: current.id } }),
  );
  if (current === null)
    return (
      <Notice
        title="还没有工作区"
        description="建好或加入一个工作区后，这里汇总它的任务、运行和排队。"
      />
    );
  const summary = query.data;
  const refresh = (
    <Button size="xs" variant="outline" disabled={query.isPending} onClick={query.refresh}>
      <RefreshIcon refreshing={query.isPending} />
      刷新
    </Button>
  );
  if (summary === null && query.error !== null)
    return <Notice title="读不到数据" description={query.error} action={refresh} />;
  const empty =
    summary !== null &&
    summary.tasks.length === 0 &&
    summary.runs.length === 0 &&
    summary.wakes.queued + summary.wakes.running + summary.pendingDecisions === 0;
  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">工作卡在哪里？</h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {summary ? (
            <span className="tabular-nums">
              数据更新于{" "}
              {new Date(summary.generatedAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
          {refresh}
        </span>
      </div>
      {summary === null ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} shape="card" className="h-24" />
          ))}
        </div>
      ) : empty ? (
        <Notice
          title="还没有数据"
          description="这个工作区还没有未完成的任务、运行或排队的唤醒。agents 开始干活后，点刷新就能看到。"
        />
      ) : (
        <SummaryView summary={summary} />
      )}
    </div>
  );
}
