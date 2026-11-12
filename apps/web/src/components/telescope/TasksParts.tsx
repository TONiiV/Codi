import { useAtomValue } from "@effect/atom-react";
import {
  isStaleTaskVersion,
  taskUpdateInput,
  taskUpdateOutcome,
} from "@t3tools/client-runtime/telescope/taskBoard";
import { failureText } from "@t3tools/client-runtime/telescope/workspaces";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { telescope, telescopeBoard, useTelescopeWorkspaces } from "./telescopeState";
import { telescopeSearch } from "./telescopeViews";

export interface BoardTarget {
  readonly environmentId: EnvironmentId;
  readonly workspaceId: Telescope.WorkspaceId;
}

export function useBoardTarget(): BoardTarget | null {
  const { environmentId, current } = useTelescopeWorkspaces();
  return environmentId && current ? { environmentId, workspaceId: current.id } : null;
}

export const TASK_STATUS = {
  todo: { label: "未开始", badge: "outline" },
  in_progress: { label: "进行中", badge: "info" },
  in_review: { label: "等你确认", badge: "warning" },
  done: { label: "完成", badge: "success" },
  needs_decision: { label: "等你决定", badge: "error" },
  dropped: { label: "已放弃", badge: "secondary" },
} as const satisfies Record<Telescope.TaskStatus, { label: string; badge: string }>;

export function StatusBadge({ status }: { status: Telescope.TaskStatus }) {
  return <Badge variant={TASK_STATUS[status].badge}>{TASK_STATUS[status].label}</Badge>;
}

const decisionLink = (hash: Telescope.DecisionId) => ({
  to: TELESCOPE_PATH,
  search: telescopeSearch("tasks", "decisions"),
  hash,
});

export function NeedsYouBadge({ task }: { task: Pick<Telescope.Task, "conflictDecisionId"> }) {
  if (task.conflictDecisionId === undefined) return null;
  return (
    <Badge variant="error" render={<Link {...decisionLink(task.conflictDecisionId)} />}>
      需要你定
    </Badge>
  );
}

/** The members and agents the caller can see, and their display names. */
export function useBoardPeople({ environmentId, workspaceId }: BoardTarget) {
  const query = { environmentId, input: { workspaceId } };
  const mine = useAtomValue(telescopeBoard.agents(query));
  const company = useAtomValue(telescopeBoard.companyAgents(query));
  const members = (
    AsyncResult.getOrElse(useAtomValue(telescope.members(query)), () => null)?.members ?? []
  ).filter((member) => member.revokedAt === undefined);
  const agents = [mine, company].flatMap(
    (result) => AsyncResult.getOrElse(result, () => null)?.agents ?? [],
  );
  const names = new Map<string, string>([
    ...agents.map((agent) => [agent.id, agent.name] as const),
    ...members.map((member) => [member.subjectId, member.displayName] as const),
  ]);
  return { members, agents, name: (id: string) => names.get(id) };
}

/** Display names for the agent and member ids the caller can see. */
export function useBoardNames(target: BoardTarget) {
  return useBoardPeople(target).name;
}

/** The caller as a member, and whether it may edit or add tasks; a 只读 member may do neither. */
export function useTaskAccess(target: BoardTarget) {
  const { environmentId, workspaceId } = target;
  const self = useEnvironmentQuery(telescope.get({ environmentId, input: { workspaceId } })).data
    ?.self;
  const mayUpdate = useAtomValue(telescopeBoard.updateTask.permissionAtom(environmentId));
  const mayCreate = useAtomValue(telescopeBoard.createTask.permissionAtom(environmentId));
  const writer = self !== undefined && self.role !== "viewer";
  return { self, mayEdit: writer && mayUpdate, mayCreate: writer && mayCreate };
}

/** 我的: owned by the caller or by one of the caller's own agents. */
export function isMyTask(
  task: Pick<Telescope.Task, "ownerSubjectId" | "ownerAgentId">,
  selfId: string | undefined,
  myAgentIds: ReadonlySet<string>,
) {
  return (
    (selfId !== undefined && task.ownerSubjectId === selfId) ||
    (task.ownerAgentId !== undefined && myAgentIds.has(task.ownerAgentId))
  );
}

export const errorText = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "请稍后再试。";
const STALE = {
  type: "warning",
  title: "任务已更新",
  description: "有人刚改过这条任务，列表已刷新，请再看一眼。",
} as const;

/** Every task write: pinned to the version on screen, with the server's outcome surfaced. */
export function useTaskWrite(target: BoardTarget) {
  const navigate = useNavigate();
  const { environmentId } = target;
  const names = useBoardNames(target);
  const update = useAtomCommand(telescopeBoard.updateTask, { reportFailure: false });
  return async (task: Telescope.Task, change: Parameters<typeof taskUpdateInput>[1]) => {
    const result = await update({ environmentId, input: taskUpdateInput(task, change) });
    if (result._tag === "Success") {
      const outcome = taskUpdateOutcome(change.set ?? {}, result.value);
      if (outcome.kind === "overwrote") {
        const who = outcome.authors.map((id) => names(id) ?? "其他成员").join("、");
        toastManager.add({ type: "info", title: `覆盖了 ${who} 刚才的修改` });
      }
      if (outcome.kind === "conflict")
        toastManager.add({
          type: "warning",
          title: "需要你定",
          description: "这次改动和别人的改动冲突，已记成一条待决定。",
          actionProps: {
            children: "去决定",
            onClick: () => void navigate(decisionLink(outcome.decisionId)),
          },
        });
      if (outcome.kind === "kept")
        toastManager.add({
          ...STALE,
          description: outcome.fields.includes("status")
            ? `状态只能往前走，保留了「${TASK_STATUS[result.value.status].label}」。`
            : "按规则保留了对方的改动。",
        });
      return true;
    }
    if (isAtomCommandInterrupted(result)) {
      toastManager.add({ type: "error", title: "没有改成", description: failureText(result) });
      return false;
    }
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      isStaleTaskVersion(error)
        ? STALE
        : { type: "error", title: "没有改成", description: errorText(error) },
    );
    return false;
  };
}

/** Other writes: a refusal surfaces the server's reason instead of failing quietly. */
export function useBoardCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  explain: (error: unknown) => string | null = () => null,
) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (value: W) => {
    const result = await run(value);
    if (result._tag === "Failure" && isAtomCommandInterrupted(result))
      toastManager.add({ type: "error", title: "没有完成", description: failureText(result) });
    else if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      const known = explain(error);
      toastManager.add(
        known === null
          ? { type: "error", title: "没有完成", description: errorText(error) }
          : { type: "warning", title: "没有完成", description: known },
      );
    }
    return result._tag === "Success";
  };
}

/** Toolbar, refresh, and the loading and error states around a board query. */
export function BoardFrame(props: {
  query: {
    data: unknown;
    isPending: boolean;
    error: string | null;
    failure: unknown;
    refresh: () => void;
  };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { query } = props;
  const error = query.error === null ? null : failureText(AsyncResult.fail(query.failure));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-4 flex h-10 shrink-0 items-center gap-0.5 border-b sm:mx-24">
        {props.actions}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="刷新"
          className="ms-auto"
          disabled={query.isPending}
          onClick={query.refresh}
        >
          {query.isPending ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>
      {query.data !== null ? (
        <>
          {error === null ? null : (
            <div className="mx-4 border-b py-2 sm:mx-24">
              <ErrorNote text={`没有读到最新内容：${error}`} onRetry={query.refresh} />
            </div>
          )}
          {props.children}
        </>
      ) : error !== null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有读到</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <Button size="xs" variant="outline" onClick={query.refresh}>
            重试
          </Button>
        </Empty>
      ) : (
        <Spinner className="m-auto" />
      )}
    </div>
  );
}

/** Shown while there is no current workspace, which until the list arrives may only mean "not yet". */
export function NoWorkspace() {
  const environmentId = usePrimaryEnvironmentId();
  const list = useEnvironmentQuery(
    environmentId === null ? null : telescope.list({ environmentId, input: {} }),
  );
  if (list.data === null && list.error !== null)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>工作区加载失败</EmptyTitle>
          <EmptyDescription>没能读到这个环境里的工作区，请检查连接后重试。</EmptyDescription>
        </EmptyHeader>
        <Button size="xs" variant="outline" onClick={list.refresh}>
          重试
        </Button>
      </Empty>
    );
  if (environmentId !== null && list.data === null)
    return (
      <Empty>
        <Spinner />
        <EmptyDescription>正在加载…</EmptyDescription>
      </Empty>
    );
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>还没有工作区</EmptyTitle>
        <EmptyDescription>
          你还没有加入这个环境里的工作区。建好或加入一个工作区后，这里会显示它的任务和决定。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
