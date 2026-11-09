import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef, Telescope } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import { readPrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { type BoardTarget, StatusBadge, useBoardTarget } from "./TasksParts";
import { telescope, telescopeBoard } from "./telescopeState";
import { telescopeSearch } from "./telescopeViews";

const holds = (threadRef: ScopedThreadRef) => (task: Telescope.Task) =>
  task.threads.some(
    (thread) =>
      thread.environmentId === threadRef.environmentId && thread.threadId === threadRef.threadId,
  );
const tasksOf = (target: BoardTarget) =>
  telescopeBoard.tasks({
    environmentId: target.environmentId,
    input: { workspaceId: target.workspaceId },
  });
const failureText = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "请稍后再试。";

/** For thread menus: absent with no workspace or grant to link into, or before the board loads. */
export function readLinkedTask(threadRef: ScopedThreadRef): Telescope.Task | null | undefined {
  const environmentId = readPrimaryEnvironmentId();
  if (environmentId === null) return undefined;
  const workspace = appAtomRegistry.get(telescope.currentWorkspaceAtom(environmentId));
  if (workspace === null) return undefined;
  if (!appAtomRegistry.get(telescopeBoard.linkThread.permissionAtom(environmentId)))
    return undefined;
  const board = AsyncResult.getOrElse(
    appAtomRegistry.get(tasksOf({ environmentId, workspaceId: workspace.id })),
    () => null,
  );
  if (board === null) return undefined;
  return board.tasks.find(holds(threadRef)) ?? null;
}

export async function unlinkThreadFromTask(threadRef: ScopedThreadRef, task: Telescope.Task) {
  const environmentId = readPrimaryEnvironmentId();
  if (environmentId === null) return;
  const result = await runAtomCommand(
    appAtomRegistry,
    telescopeBoard.unlinkThread,
    {
      environmentId,
      input: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
      },
    },
    { reportFailure: false },
  );
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
    toastManager.add({
      type: "error",
      title: "没能解除关联",
      description: failureText(squashAtomCommandFailure(result)),
    });
}

// Hosted at the root, so it outlives the menu or command palette that opened it.
const linkTaskDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("telescope:link-task-dialog-thread"),
);

export function openLinkTaskDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linkTaskDialogThreadAtom, threadRef);
}

export function LinkTaskDialogHost() {
  const threadRef = useAtomValue(linkTaskDialogThreadAtom);
  const target = useBoardTarget();
  if (threadRef === null || target === null) return null;
  return (
    <LinkTaskDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      target={target}
      onClose={() => appAtomRegistry.set(linkTaskDialogThreadAtom, null)}
    />
  );
}

const CLOSED = new Set<Telescope.TaskStatus>(["done", "dropped"]);

function LinkTaskDialog(props: {
  threadRef: ScopedThreadRef;
  target: BoardTarget;
  onClose: () => void;
}) {
  const { threadRef, target } = props;
  const query = useEnvironmentQuery(tasksOf(target));
  const threadTitle = useThreadShell(threadRef)?.title ?? "这个对话";
  const link = useAtomCommand(telescopeBoard.linkThread, { reportFailure: false });
  const [pending, setPending] = useState<Telescope.TaskId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tasks = query.data?.tasks ?? null;
  const linked = tasks?.find(holds(threadRef)) ?? null;
  const pick = async (task: Telescope.Task) => {
    setPending(task.id);
    setError(null);
    const result = await link({
      environmentId: target.environmentId,
      input: {
        workspaceId: target.workspaceId,
        taskId: task.id,
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
      },
    });
    setPending(null);
    if (result._tag === "Success") return props.onClose();
    if (!isAtomCommandInterrupted(result)) setError(failureText(squashAtomCommandFailure(result)));
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>关联到任务</DialogTitle>
          <DialogDescription>
            把「{threadTitle}
            」关联到当前工作区的一个任务。一个对话只属于一个任务，解除关联不会删除对话。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            {tasks === null ? (
              query.error === null ? (
                <Spinner className="m-auto" />
              ) : (
                <p className="text-sm text-destructive-foreground">没有读到任务：{query.error}</p>
              )
            ) : linked !== null ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">已关联到「{linked.title}」</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void unlinkThreadFromTask(threadRef, linked)}
                >
                  解除关联
                </Button>
              </div>
            ) : (
              <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {tasks
                  .filter((task) => !CLOSED.has(task.status))
                  .map((task) => (
                    <li key={task.id}>
                      <Button
                        variant="ghost"
                        className="w-full justify-between"
                        disabled={pending !== null}
                        onClick={() => void pick(task)}
                      >
                        <span className="min-w-0 truncate">{task.title}</span>
                        {pending === task.id ? <Spinner /> : <StatusBadge status={task.status} />}
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
            {error === null ? null : <p className="text-sm text-destructive-foreground">{error}</p>}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** The Telescope task a Code thread belongs to, as a link that opens it on the board. */
export function ThreadTaskBadge({ threadRef }: { threadRef: ScopedThreadRef }) {
  const target = useBoardTarget();
  const query = useEnvironmentQuery(target === null ? null : tasksOf(target));
  const task = query.data?.tasks.find(holds(threadRef)) ?? null;
  if (task === null) return null;
  return (
    <Badge
      variant="outline"
      size="sm"
      render={<Link to={TELESCOPE_PATH} search={telescopeSearch("tasks", "table", task.id)} />}
    >
      任务 · {task.title}
    </Badge>
  );
}
