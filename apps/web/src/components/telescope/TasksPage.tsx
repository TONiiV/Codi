import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { TelescopeEmptyState } from "./TelescopeShell";
import { telescopeBoard } from "./telescopeState";
import {
  BoardFrame,
  type BoardTarget,
  NoWorkspace,
  useBoardCommand,
  useBoardTarget,
} from "./TasksParts";
import { TasksTable } from "./TasksViews";

function NewTaskDialog({ target }: { target: BoardTarget }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useBoardCommand(telescopeBoard.createTask);
  const input = { workspaceId: target.workspaceId, title: title.trim() };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="xs" onClick={() => setOpen(true)}>
        <PlusIcon /> 新任务
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>新任务</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <form
            id="telescope-new-task"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await create({ environmentId: target.environmentId, input })) {
                setTitle("");
                setOpen(false);
              }
            }}
          >
            <Input
              autoFocus
              aria-label="任务标题"
              placeholder="要做什么"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </form>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
          <Button type="submit" form="telescope-new-task" disabled={input.title.length === 0}>
            创建
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function TasksBody({ target }: { target: BoardTarget }) {
  const input = { workspaceId: target.workspaceId };
  const query = useEnvironmentQuery(
    telescopeBoard.tasks({ environmentId: target.environmentId, input }),
  );
  const tasks = query.data?.tasks ?? [];
  return (
    <BoardFrame query={query} actions={<NewTaskDialog target={target} />}>
      {tasks.length === 0 ? (
        <TelescopeEmptyState view="tasks" />
      ) : (
        <TasksTable target={target} tasks={tasks} />
      )}
    </BoardFrame>
  );
}

export function TasksPage() {
  const target = useBoardTarget();
  return target === null ? <NoWorkspace /> : <TasksBody target={target} />;
}
