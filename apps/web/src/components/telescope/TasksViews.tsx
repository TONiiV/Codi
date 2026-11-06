import { TASK_STATUSES, tasksByStatus } from "@t3tools/client-runtime/telescope/taskBoard";
import { Telescope } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Textarea } from "../ui/textarea";
import { telescopeBoard } from "./telescopeState";
import {
  type BoardTarget,
  NeedsYouBadge,
  StatusBadge,
  TASK_STATUS,
  useBoardNames,
  useTaskWrite,
} from "./TasksParts";

type Write = ReturnType<typeof useTaskWrite>;
type Names = ReturnType<typeof useBoardNames>;

function TitleCell({ task, write }: { task: Telescope.Task; write: Write }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const title = draft?.trim() ?? "";
    setDraft(null);
    if (title.length > 0 && title !== task.title) void write(task, { set: { title } });
  };
  return draft === null ? (
    <Button
      variant="ghost"
      size="sm"
      className="min-w-0 shrink"
      onClick={() => setDraft(task.title)}
    >
      <span className="truncate">{task.title}</span>
    </Button>
  ) : (
    <Input
      size="sm"
      autoFocus
      aria-label="任务标题"
      maxLength={Telescope.BOARD_LIMITS.titleLength}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") save();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** Notes are append-only entries signed by their author; `get` carries all of them. */
function TaskNotes({
  target,
  task,
  write,
  names,
}: {
  target: BoardTarget;
  task: Telescope.Task;
  write: Write;
  names: Names;
}) {
  const [note, setNote] = useState("");
  const input = { workspaceId: target.workspaceId, taskId: task.id };
  const full =
    useEnvironmentQuery(telescopeBoard.task({ environmentId: target.environmentId, input })).data ??
    task;
  return (
    <div className="flex max-w-2xl flex-col items-start gap-2 py-2 ps-8">
      {full.freeText.map((entry) => (
        <p key={`${entry.at}-${entry.authorId}`} className="whitespace-pre-wrap">
          <span className="me-2 text-xs text-muted-foreground">
            {names(entry.authorId) ?? "其他成员"} · {new Date(entry.at).toLocaleString()}
          </span>
          {entry.text}
        </p>
      ))}
      <Textarea
        aria-label="新备注"
        placeholder="写一条备注，所有成员都看得到"
        maxLength={Telescope.BOARD_LIMITS.noteLength}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button
        size="xs"
        disabled={note.trim().length === 0}
        onClick={async () => {
          if (await write(task, { note: note.trim() })) setNote("");
        }}
      >
        添加备注
      </Button>
    </div>
  );
}

function TaskRow(props: { target: BoardTarget; task: Telescope.Task; write: Write; names: Names }) {
  const { target, task, write, names } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell>
          <span className="flex min-w-0 items-center gap-1">
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="备注"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </Button>
            <TitleCell task={task} write={write} />
            <NeedsYouBadge task={task} />
          </span>
        </TableCell>
        <TableCell>
          <Select
            value={task.status}
            onValueChange={(status) => {
              if (status !== null && status !== task.status) void write(task, { set: { status } });
            }}
          >
            <SelectTrigger size="sm" aria-label="状态">
              <SelectValue>{TASK_STATUS[task.status].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {Telescope.TaskStatus.literals.map((status) => (
                <SelectItem key={status} value={status}>
                  {TASK_STATUS[status].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </TableCell>
        <TableCell>
          <span className="text-muted-foreground">
            {task.ownerAgentId && (names(task.ownerAgentId) ?? "其他成员的 agent")}
          </span>
        </TableCell>
        <TableCell>
          <span className="text-muted-foreground tabular-nums">v{task.version}</span>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={4}>
            <TaskNotes target={target} task={task} write={write} names={names} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function TasksTable(props: { target: BoardTarget; tasks: ReadonlyArray<Telescope.Task> }) {
  const write = useTaskWrite(props.target);
  const names = useBoardNames(props.target);
  return (
    <Table className="min-w-160 table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>任务</TableHead>
          <TableHead className="w-36">状态</TableHead>
          <TableHead className="w-40">负责 agent</TableHead>
          <TableHead className="w-16">版本</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.tasks.map((task) => (
          <TaskRow key={task.id} target={props.target} task={task} write={write} names={names} />
        ))}
      </TableBody>
    </Table>
  );
}

const DRAG_TYPE = "application/x-telescope-task";

/** One column per status; a drop is a `task.update` pinned to the card's version. */
export function TasksBoard(props: { target: BoardTarget; tasks: ReadonlyArray<Telescope.Task> }) {
  const write = useTaskWrite(props.target);
  const names = useBoardNames(props.target);
  const [over, setOver] = useState<Telescope.TaskStatus | null>(null);
  const columns = tasksByStatus(props.tasks);
  return (
    <div className="flex items-start gap-3 overflow-x-auto p-4">
      {TASK_STATUSES.map((status) => (
        <section
          key={status}
          aria-label={TASK_STATUS[status].label}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            setOver(status);
          }}
          onDragLeave={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOver(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            const id = event.dataTransfer.getData(DRAG_TYPE);
            const task = props.tasks.find((item) => item.id === id);
            if (task && task.status !== status) void write(task, { set: { status } });
          }}
          className={cn(
            "flex w-64 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2",
            over === status && "ring-2 ring-primary/40",
          )}
        >
          <header className="flex items-center gap-2 px-1 pt-1">
            <StatusBadge status={status} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {columns[status].length}
            </span>
          </header>
          {columns[status].map((task) => (
            <div
              key={task.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, task.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              className="flex cursor-grab flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs"
            >
              <span className="font-medium wrap-anywhere">{task.title}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <NeedsYouBadge task={task} />
                {task.ownerAgentId && (names(task.ownerAgentId) ?? "其他成员的 agent")}
                <span className="ms-auto tabular-nums">v{task.version}</span>
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
