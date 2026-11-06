import { useAtomValue } from "@effect/atom-react";
import {
  isStaleTaskVersion,
  taskUpdateInput,
  taskUpdateOutcome,
} from "@t3tools/client-runtime/telescope/taskBoard";
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

import { useAtomCommand } from "../../state/use-atom-command";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { telescope, telescopeBoard, useTelescopeWorkspaces } from "./telescopeState";

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
  in_review: { label: "等确认", badge: "warning" },
  done: { label: "完成", badge: "success" },
  needs_decision: { label: "等你决定", badge: "error" },
  dropped: { label: "已放弃", badge: "secondary" },
} as const satisfies Record<Telescope.TaskStatus, { label: string; badge: string }>;

const decisionLink = (hash: Telescope.DecisionId) => ({
  to: TELESCOPE_PATH,
  search: { view: "decisions" as const },
  hash,
});

export function NeedsYouBadge({ task }: { task: Telescope.Task }) {
  if (task.conflictDecisionId === undefined) return null;
  return (
    <Badge variant="error" render={<Link {...decisionLink(task.conflictDecisionId)} />}>
      需要你定
    </Badge>
  );
}

/** Display names for the agent and member ids the caller can see. */
export function useBoardNames({ environmentId, workspaceId }: BoardTarget) {
  const query = { environmentId, input: { workspaceId } };
  const mine = useAtomValue(telescopeBoard.agents(query));
  const company = useAtomValue(telescopeBoard.companyAgents(query));
  const members = AsyncResult.getOrElse(useAtomValue(telescope.members(query)), () => null);
  const names = new Map<string, string>([
    ...[mine, company]
      .flatMap((result) => AsyncResult.getOrElse(result, () => null)?.agents ?? [])
      .map((agent) => [agent.id, agent.name] as const),
    ...(members?.members ?? []).map((member) => [member.subjectId, member.displayName] as const),
  ]);
  return (id: string) => names.get(id);
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "请稍后再试。";
const STALE = { type: "warning", title: "已被别人改过，请重新看" } as const;

/** Every task write: pinned to the version on screen, with the server's outcome surfaced. */
export function useTaskWrite({ environmentId }: BoardTarget) {
  const navigate = useNavigate();
  const update = useAtomCommand(telescopeBoard.updateTask, { reportFailure: false });
  return async (task: Telescope.Task, change: Parameters<typeof taskUpdateInput>[1]) => {
    const result = await update({ environmentId, input: taskUpdateInput(task, change) });
    if (result._tag === "Success") {
      const outcome = taskUpdateOutcome(change.set ?? {}, result.value);
      const status = TASK_STATUS[result.value.status].label;
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
            ? `状态只能往前走，保留了「${status}」。`
            : "按规则保留了对方的改动。",
        });
      return true;
    }
    if (isAtomCommandInterrupted(result)) return false;
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
export function useBoardCommand<W, A, E>(command: AtomCommand<W, A, E>) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (value: W) => {
    const result = await run(value);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const description = errorText(squashAtomCommandFailure(result));
      toastManager.add({ type: "error", title: "没有完成", description });
    }
    return result._tag === "Success";
  };
}

/** Toolbar, refresh, and the loading and error states around a board query. */
export function BoardFrame(props: {
  query: { data: unknown; isPending: boolean; error: string | null; refresh: () => void };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { query } = props;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-4 py-2">
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
        props.children
      ) : query.error !== null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有读到</EmptyTitle>
            <EmptyDescription>{query.error}</EmptyDescription>
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

export function NoWorkspace() {
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
