import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { reportsInOrder } from "@t3tools/client-runtime/telescope/taskBoard";
import type { EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, MessageSquarePlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useSideChat } from "../chat/useSideChat";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { telescopeBoard } from "./telescopeState";
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
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

const time = (at: string) => new Date(at).toLocaleString();

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
      render={<Link to="/$environmentId/$threadId" params={buildThreadRouteParams(ref)} />}
    >
      <span className="truncate">{title ?? "关联的对话"}</span>
    </Button>
  );
}

/** Forks the task's thread into a side chat that opens on the task, then shows that thread. */
function SideChatButton({
  environmentId,
  task,
}: {
  environmentId: EnvironmentId;
  task: Telescope.Task;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const threadRef =
    task.threadId === undefined ? null : scopeThreadRef(environmentId, task.threadId);
  const sideChat = useSideChat({
    threadRef,
    onError: (description) =>
      toastManager.add({ type: "error", title: "没能加到 side chat", description }),
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
        disabled={threadRef === null || pending}
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
      {threadRef === null ? (
        <p className="text-xs text-muted-foreground">
          这条任务还没有关联对话，关联后才能在 side chat 里聊它。
        </p>
      ) : null}
    </div>
  );
}

function TaskDetail({ target, taskId }: { target: BoardTarget; taskId: Telescope.TaskId }) {
  const { environmentId } = target;
  const input = { workspaceId: target.workspaceId, taskId };
  const query = useEnvironmentQuery(telescopeBoard.task({ environmentId, input }));
  const lease = useEnvironmentQuery(telescopeBoard.lease({ environmentId, input })).data?.lease;
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
  const reports = reportsInOrder(task.freeText);
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
        <Field label="租约">
          {lease && holder ? (
            <p>
              {holder} 在做{" "}
              <span className="text-muted-foreground">
                · 从 {time(lease.acquiredAt)} 起 · {time(lease.expiresAt)} 到期
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">空闲</p>
          )}
        </Field>
        <Field label="关联">
          {task.forgeIssue ? (
            <Button
              variant="link"
              size="sm"
              render={<a href={task.forgeIssue.url} target="_blank" rel="noopener noreferrer" />}
            >
              {task.forgeIssue.repo}#{task.forgeIssue.number}
              <ExternalLinkIcon />
            </Button>
          ) : (
            <p className="text-muted-foreground">没有关联 issue</p>
          )}
          {task.threadId ? (
            <ThreadLink environmentId={environmentId} threadId={task.threadId} />
          ) : (
            <p className="text-muted-foreground">没有关联对话</p>
          )}
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
        <SideChatButton environmentId={environmentId} task={task} />
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
