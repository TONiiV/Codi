import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { leaseRecheckDelay } from "@t3tools/client-runtime/telescope/taskBoard";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_RUNTIME_MODE,
  type Telescope,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  CircleDashedIcon,
  ExternalLinkIcon,
  LinkIcon,
  MessageSquarePlusIcon,
  UnlinkIcon,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { useThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadFamilies } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { sideChatSourceBlock } from "../ChatView.logic";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { type SideChatFailureStage, useSideChat } from "../chat/useSideChat";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { Property, TaskPage } from "./TaskPage";
import { telescope, telescopeBoard } from "./telescopeState";
import { unlinkThreadFromTask } from "./ThreadTaskLink";
import { type BoardTarget, useBoardNames, useTaskWrite } from "./TasksParts";

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
    <Property icon={CircleDashedIcon} label="租约">
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
        <Skeleton className="h-5 w-32" />
      )}
      {query.error === null ? null : (
        <ErrorNote
          text={query.data === null ? "没有读到租约" : "没有读到最新的租约"}
          onRetry={query.refresh}
        />
      )}
    </Property>
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

function SubTask({
  thread,
  task,
  mayUnlink,
}: {
  thread: Telescope.TaskThread;
  task: Telescope.Task;
  mayUnlink: boolean;
}) {
  const ref = scopeThreadRef(thread.environmentId, thread.threadId);
  const shell = useThreadShell(ref);
  const status = shell === null ? null : resolveThreadStatusPill({ thread: shell });
  return (
    <li className="-mx-1.5 flex min-h-7.5 items-center gap-2 rounded-md px-1.5 hover:bg-accent">
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(ref)}
        className="min-w-0 flex-1 truncate text-base"
      >
        {shell?.title ?? "关联的对话"}
      </Link>
      {status === null ? null : <ThreadStatusLabel status={status} />}
      {mayUnlink ? (
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label="解除关联"
          title="解除关联（对话不会被删除）"
          onClick={() => void unlinkThreadFromTask(ref, task)}
        >
          <UnlinkIcon />
        </Button>
      ) : null}
    </li>
  );
}

/** The task's linked Code threads, read as its sub-tasks. */
function SubTasks({ task, mayUnlink }: { task: Telescope.Task; mayUnlink: boolean }) {
  return (
    <section aria-label="子任务" className="flex flex-col gap-1">
      <h2 className="font-semibold text-2xl leading-8">子任务</h2>
      {task.threads.length === 0 ? (
        <p className="text-base text-muted-foreground">没有关联对话</p>
      ) : (
        <ul className="flex flex-col">
          {task.threads.map((thread) => (
            <SubTask
              key={`${thread.environmentId}:${thread.threadId}`}
              thread={thread}
              task={task}
              mayUnlink={mayUnlink}
            />
          ))}
        </ul>
      )}
    </section>
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
    // The side chat keeps the mode and model its source thread has.
    readSettings: () => ({
      runtimeMode: thread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      modelSelection: undefined,
    }),
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

export function TaskDetail({ target, taskId }: { target: BoardTarget; taskId: Telescope.TaskId }) {
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
  const board = { environmentId, input: { workspaceId: target.workspaceId } };
  const self = useEnvironmentQuery(telescope.get(board)).data?.self ?? null;
  const agents = [
    useAtomValue(telescopeBoard.agents(board)),
    useAtomValue(telescopeBoard.companyAgents(board)),
  ].flatMap((result) => AsyncResult.getOrElse(result, () => null)?.agents ?? []);
  // A viewer (只读) is refused every write, so it gets the page without controls.
  const member = self !== null && self.role !== "viewer";
  const mayWrite = useAtomValue(telescopeBoard.updateTask.permissionAtom(environmentId)) && member;
  const mayUnlink =
    useAtomValue(telescopeBoard.unlinkThread.permissionAtom(environmentId)) && member;
  const write = useTaskWrite(target);
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
  return (
    <TaskPage
      task={task}
      write={mayWrite ? write : null}
      names={names}
      agents={agents}
      selfName={self?.displayName ?? ""}
      properties={
        <>
          <LeaseField lease={lease} holder={holder} query={leaseQuery} />
          {task.forgeIssue ? (
            <Property icon={LinkIcon} label="Issue">
              <a
                href={task.forgeIssue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {task.forgeIssue.repo}#{task.forgeIssue.number}
                <ExternalLinkIcon className="size-3.5" />
              </a>
            </Property>
          ) : null}
        </>
      }
    >
      <SubTasks task={task} mayUnlink={mayUnlink} />
      <SideChatButton task={task} />
    </TaskPage>
  );
}
