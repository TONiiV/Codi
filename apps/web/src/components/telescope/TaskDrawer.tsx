import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { leaseRecheckDelay } from "@t3tools/client-runtime/telescope/taskBoard";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type Telescope,
  type ThreadId,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, MessageSquarePlusIcon, UnlinkIcon } from "lucide-react";
import { type ReactNode, useContext, useEffect, useState } from "react";

import { useThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadFamilies } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { sideChatSourceBlock } from "../ChatView.logic";
import { type SideChatFailureStage, useSideChat } from "../chat/useSideChat";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { telescopeBoard } from "./telescopeState";
import { unlinkThreadFromTask } from "./ThreadTaskLink";
import {
  type BoardTarget,
  NeedsYouBadge,
  StatusBadge,
  useBoardNames,
  useBoardTarget,
} from "./TasksParts";
import {
  telescopeSearch,
  useTasksLayout,
  useTaskDrawerId,
  useTelescopeView,
} from "./telescopeViews";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

const time = (at: string) => new Date(at).toLocaleString();

export function LeaseField({
  lease,
  holder,
  query,
}: {
  lease: Telescope.Lease | undefined;
  holder: string | undefined;
  query: { data: unknown; error: string | null; refresh: () => void };
}) {
  return (
    <Field label="租约">
      {lease && holder ? (
        <p>
          {holder} 在做{" "}
          <span className="text-muted-foreground">
            · 从 {time(lease.acquiredAt)} 起 · {time(lease.expiresAt)} 到期
          </span>
        </p>
      ) : query.data !== null ? (
        <p className="text-muted-foreground">空闲</p>
      ) : query.error !== null ? null : (
        <Skeleton className="h-5 w-48" />
      )}
      {query.error === null ? null : (
        <ErrorNote
          text={query.data === null ? "没有读到租约" : "没有读到最新的租约"}
          onRetry={query.refresh}
        />
      )}
    </Field>
  );
}

const SIDE_CHAT_BLOCKED = {
  sideChat: "关联的对话本身就是 side chat，不能再从它开 side chat。",
  subagent: "关联的对话是 subagent 对话，不能从它开 side chat。",
  loading: "side chat 还没准备好，稍后再试。",
  unsupported: "这个环境的 Codi 服务器还不支持 side chat，更新后才能用。",
  forbidden: "你在这个环境里没有操作对话的权限。",
  gone: "关联的对话已归档或删除，不能从它开 side chat。",
} as const;

const SIDE_CHAT_FAILED: Record<SideChatFailureStage, string> = {
  fork: "服务器没有开出 side chat，请稍后再试。",
  refused: "服务器不允许从关联的对话开 side chat，它可能已归档，或是 subagent、side chat。",
  sync: "side chat 没有同步到这台设备，请再试一次。",
  send: "第一条消息没有发出去，请再试一次。",
};

function ThreadLink({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const ref = scopeThreadRef(environmentId, threadId);
  const title = useThreadShell(ref)?.title;
  return (
    <Button
      variant="link"
      size="sm"
      className="-ms-2.5"
      render={<Link to="/$environmentId/$threadId" params={buildThreadRouteParams(ref)} />}
    >
      <span className="truncate">{title ?? "关联的对话"}</span>
    </Button>
  );
}

function LinkedThreads({
  environmentId,
  task,
}: {
  environmentId: EnvironmentId;
  task: Telescope.Task;
}) {
  const mayUnlink = useAtomValue(telescopeBoard.unlinkThread.permissionAtom(environmentId));
  if (task.threads.length === 0) return <p className="text-muted-foreground">没有关联对话</p>;
  return (
    <ul className="flex flex-col items-start">
      {task.threads.map((thread) => (
        <li key={`${thread.environmentId}:${thread.threadId}`} className="flex items-center gap-1">
          <ThreadLink environmentId={thread.environmentId} threadId={thread.threadId} />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="解除关联"
            title="解除关联（对话不会被删除）"
            disabled={!mayUnlink}
            onClick={() =>
              void unlinkThreadFromTask(scopeThreadRef(thread.environmentId, thread.threadId), task)
            }
          >
            <UnlinkIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Forks the task's first thread into a side chat that opens on the task, then shows that thread. */
function SideChatButton({ task }: { task: Telescope.Task }) {
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const [pending, setPending] = useState(false);
  const [first] = task.threads;
  const threadRef =
    first === undefined ? null : scopeThreadRef(first.environmentId, first.threadId);
  const environmentId = threadRef?.environmentId ?? null;
  const capabilities = useEnvironment(environmentId)?.serverConfig?.environment.capabilities;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const shell = useThreadShell(threadRef);
  // The shell omits idle subagents; their family read still carries the lineage.
  const family = useEnvironmentQuery(
    threadRef !== null && shell === null
      ? threadFamilies.familyAtom(threadRef.environmentId, threadRef.threadId)
      : null,
  );
  const thread = shell ?? family.data?.threads.find((row) => row.id === first?.threadId) ?? null;
  const familyFailed = family.data === null && family.error !== null;
  // The shell and the family read carry active threads only.
  const block =
    family.data === null && family.isPending
      ? "loading"
      : family.data !== null && thread === null
        ? "gone"
        : sideChatSourceBlock(thread, capabilities ?? null, canOperate);
  const hint =
    threadRef === null
      ? "这条任务还没有关联对话，关联后才能在 side chat 里聊它。"
      : block === null
        ? null
        : SIDE_CHAT_BLOCKED[block];
  const sideChat = useSideChat({
    threadRef,
    onError: (_message, stage) =>
      toastManager.add({
        type: "error",
        title: "没能加到 side chat",
        description: SIDE_CHAT_FAILED[stage],
      }),
  });
  const prompt = [
    `关于任务「${task.title}」（${task.id}）`,
    ...(task.forgeIssue ? [`关联 issue：${task.forgeIssue.url}`] : []),
    "先说说现在的进展、卡在哪里、下一步打算。",
  ].join("\n");
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        size="sm"
        disabled={hint !== null || familyFailed || pending}
        onClick={async () => {
          if (threadRef === null) return;
          setPending(true);
          const opened = await sideChat.open(prompt);
          setPending(false);
          if (opened)
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(threadRef),
            });
        }}
      >
        {pending ? <Spinner /> : <MessageSquarePlusIcon />}
        加到 side chat
      </Button>
      {familyFailed && threadRef !== null ? (
        <ErrorNote
          text="没有读到关联对话的状态"
          onRetry={() =>
            threadFamilies.refresh(registry, threadRef.environmentId, threadRef.threadId)
          }
        />
      ) : hint === null ? null : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function TaskDetail({ target, taskId }: { target: BoardTarget; taskId: Telescope.TaskId }) {
  const { environmentId } = target;
  const input = { workspaceId: target.workspaceId, taskId };
  const query = useEnvironmentQuery(telescopeBoard.task({ environmentId, input }));
  const leaseQuery = useEnvironmentQuery(telescopeBoard.lease({ environmentId, input }));
  const lease = leaseQuery.data?.lease;
  const { dataUpdatedAt, refresh: refreshLease } = leaseQuery;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a lease lapses on the server's clock with no notice, so re-read it then
  useEffect(() => {
    const delay = leaseRecheckDelay(lease, Date.now(), dataUpdatedAt);
    if (delay === null) return;
    const handle = window.setTimeout(refreshLease, delay);
    return () => window.clearTimeout(handle);
  }, [lease, dataUpdatedAt, refreshLease]);
  const names = useBoardNames(target);
  const task = query.data;
  if (task === null)
    return query.error === null ? (
      <Spinner className="m-auto" />
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>没有读到这条任务</EmptyTitle>
          <EmptyDescription>{query.error}</EmptyDescription>
        </EmptyHeader>
        <Button size="xs" variant="outline" onClick={query.refresh}>
          重试
        </Button>
      </Empty>
    );
  const holder =
    lease && (names(lease.holderAgentId) ?? names(lease.holderSubjectId) ?? "其他成员的 agent");
  const reports = task.freeText;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="me-8 wrap-anywhere">{task.title}</SheetTitle>
        <SheetDescription render={<div />} className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <NeedsYouBadge task={task} />
          {task.ownerAgentId ? (
            <span>负责 agent：{names(task.ownerAgentId) ?? "其他成员的 agent"}</span>
          ) : null}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 text-sm">
        <LeaseField lease={lease} holder={holder} query={leaseQuery} />
        <Field label="关联">
          {task.forgeIssue ? (
            <Button
              variant="link"
              size="sm"
              className="-ms-2.5"
              render={<a href={task.forgeIssue.url} target="_blank" rel="noopener noreferrer" />}
            >
              {task.forgeIssue.repo}#{task.forgeIssue.number}
              <ExternalLinkIcon />
            </Button>
          ) : (
            <p className="text-muted-foreground">没有关联 issue</p>
          )}
          <LinkedThreads environmentId={environmentId} task={task} />
        </Field>
        <Field label={`汇报 ${reports.length}`}>
          {reports.length === 0 ? (
            <p className="text-muted-foreground">还没有汇报</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {reports.map((entry) => (
                <li key={`${entry.at}-${entry.authorId}`} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    {names(entry.authorId) ?? "其他成员"} · {time(entry.at)}
                  </span>
                  <p className="whitespace-pre-wrap wrap-anywhere">{entry.text}</p>
                </li>
              ))}
            </ol>
          )}
        </Field>
        <SideChatButton task={task} />
      </div>
    </>
  );
}

/** The task named by the URL's `task` search param, over whichever Telescope view is open. */
export function TaskDrawer() {
  const taskId = useTaskDrawerId();
  const view = useTelescopeView();
  const layout = useTasksLayout();
  const target = useBoardTarget();
  const navigate = useNavigate();
  const open = taskId !== null && target !== null && view !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && view !== null)
          void navigate({
            to: TELESCOPE_PATH,
            search: telescopeSearch(view, layout),
            replace: true,
          });
      }}
    >
      <SheetPopup>{open ? <TaskDetail target={target} taskId={taskId} /> : null}</SheetPopup>
    </Sheet>
  );
}
