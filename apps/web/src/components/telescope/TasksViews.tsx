import { TASK_STATUSES, tasksByStatus } from "@t3tools/client-runtime/telescope/taskBoard";
import { Telescope } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  CalendarIcon,
  CaseSensitiveIcon,
  CircleChevronDownIcon,
  CircleDotDashedIcon,
  PanelRightOpenIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { Input, type InputProps } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { formatDueDate, PersonChip, PriorityTag, STATUS_TONE, StatusPill } from "./TaskProperties";
import {
  type BoardTarget,
  NeedsYouBadge,
  TASK_STATUS,
  useBoardPeople,
  useTaskWrite,
} from "./TasksParts";
import { telescopeSearch, useTasksProjectId } from "./telescopeViews";

type People = ReturnType<typeof useBoardPeople>;
type Fields = Telescope.TaskFields;
/** Creates a task in the view's project; null for a member who may not. */
export type CreateTask = ((title: string, set?: Fields) => Promise<boolean>) | null;
type Editable = "title" | "status" | "ownerSubjectId" | "ownerAgentId" | "dueDate" | "priority";
/** Writes the fields that differ from the task; null for a member who may not edit. */
type Edit = ((task: Telescope.Task, set: Pick<Fields, Editable>) => void) | null;

const isDueDate = Schema.is(Telescope.TaskDueDate);

const NONE = "";

const CELL =
  "flex h-9 w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden px-2 text-left whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const CELL_STATIC = "flex h-9 min-w-0 items-center gap-1.5 overflow-hidden px-2 whitespace-nowrap";

type CellProps = { task: Telescope.Task; edit: Edit; people: People };

/** A cell that opens a menu to edit it, or shows the value alone for a reader. */
function MenuCell(props: { label: string; edit: boolean; value: ReactNode; children: ReactNode }) {
  if (!props.edit) return <div className={CELL_STATIC}>{props.value}</div>;
  return (
    <Menu>
      <MenuTrigger render={<button type="button" aria-label={props.label} className={CELL} />}>
        {props.value}
      </MenuTrigger>
      <MenuPopup align="start">{props.children}</MenuPopup>
    </Menu>
  );
}

function StatusCell({ task, edit }: CellProps) {
  return (
    <MenuCell label="状态" edit={edit !== null} value={<StatusPill status={task.status} />}>
      <MenuRadioGroup value={task.status}>
        {Telescope.TaskStatus.literals.map((status) => (
          <MenuRadioItem
            key={status}
            value={status}
            closeOnClick
            onClick={() => edit?.(task, { status })}
          >
            <StatusPill status={status} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuCell>
  );
}

function PriorityCell({ task, edit }: CellProps) {
  const pick = (priority: Telescope.TaskPriority | null) => edit?.(task, { priority });
  return (
    <MenuCell
      label="优先级"
      edit={edit !== null}
      value={task.priority && <PriorityTag priority={task.priority} />}
    >
      <MenuRadioGroup value={task.priority ?? NONE}>
        <MenuRadioItem value={NONE} closeOnClick onClick={() => pick(null)}>
          <span className="text-muted-foreground">无</span>
        </MenuRadioItem>
        {Telescope.TaskPriority.literals.map((priority) => (
          <MenuRadioItem
            key={priority}
            value={priority}
            closeOnClick
            onClick={() => pick(priority)}
          >
            <PriorityTag priority={priority} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuCell>
  );
}

function Owners({
  task,
  people,
  small = false,
}: {
  task: Telescope.Task;
  people: People;
  small?: boolean;
}) {
  return (
    <>
      {task.ownerSubjectId && (
        <PersonChip small={small} name={people.name(task.ownerSubjectId) ?? "其他成员"} />
      )}
      {task.ownerAgentId && (
        <PersonChip
          small={small}
          agent
          name={people.name(task.ownerAgentId) ?? "其他成员的 agent"}
        />
      )}
    </>
  );
}

function OwnerCell({ task, edit, people }: CellProps) {
  return (
    <MenuCell label="负责人" edit={edit !== null} value={<Owners task={task} people={people} />}>
      <MenuGroup>
        <MenuGroupLabel>成员</MenuGroupLabel>
        <MenuRadioGroup value={task.ownerSubjectId ?? NONE}>
          <MenuRadioItem
            value={NONE}
            closeOnClick
            onClick={() => edit?.(task, { ownerSubjectId: null })}
          >
            <span className="text-muted-foreground">无</span>
          </MenuRadioItem>
          {people.members.map((member) => (
            <MenuRadioItem
              key={member.subjectId}
              value={member.subjectId}
              closeOnClick
              onClick={() => edit?.(task, { ownerSubjectId: member.subjectId })}
            >
              <PersonChip name={member.displayName} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>Agent</MenuGroupLabel>
        <MenuRadioGroup value={task.ownerAgentId ?? NONE}>
          <MenuRadioItem
            value={NONE}
            closeOnClick
            onClick={() => edit?.(task, { ownerAgentId: null })}
          >
            <span className="text-muted-foreground">无</span>
          </MenuRadioItem>
          {people.agents.map((agent) => (
            <MenuRadioItem
              key={agent.id}
              value={agent.id}
              closeOnClick
              onClick={() => edit?.(task, { ownerAgentId: agent.id })}
            >
              <PersonChip agent name={agent.name} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </MenuCell>
  );
}

/**
 * Mounted only while editing: Enter and blur commit, Escape cancels. Enter and Escape blur the
 * input as it unmounts; that blur must not commit again.
 */
function EditInput({
  onCommit,
  onCancel,
  ...props
}: Omit<InputProps, "onBlur" | "onKeyDown"> & {
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const settled = useRef(false);
  return (
    <Input
      {...props}
      autoFocus
      size="sm"
      onBlur={(event) => {
        if (!settled.current) onCommit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key !== "Enter" && event.key !== "Escape") return;
        settled.current = true;
        if (event.key === "Enter") onCommit(event.currentTarget.value);
        else onCancel();
      }}
    />
  );
}

/** Shows the day; a click swaps in the native date input. */
function DueCell({ task, edit }: CellProps) {
  // The write is pinned to the version the editor opened on, so a change made meanwhile conflicts.
  const [editing, setEditing] = useState<Telescope.Task | null>(null);
  // A stored day the input cannot show (2026-02-31) reads as empty, so only a change is sent.
  const changed = useRef(false);
  const shown = task.dueDate && formatDueDate(task.dueDate);
  if (edit === null) return <div className={CELL_STATIC}>{shown}</div>;
  if (editing === null)
    return (
      <button
        type="button"
        aria-label="截止日期"
        className={CELL}
        onClick={() => {
          changed.current = false;
          setEditing(task);
        }}
      >
        {shown}
      </button>
    );
  return (
    <EditInput
      unstyled
      nativeInput
      type="date"
      aria-label="截止日期"
      defaultValue={editing.dueDate ?? ""}
      onChange={() => (changed.current = true)}
      onCommit={(value) => {
        setEditing(null);
        if (!changed.current) return;
        if (value === "") edit(editing, { dueDate: null });
        else if (isDueDate(value)) edit(editing, { dueDate: value });
      }}
      onCancel={() => setEditing(null)}
    />
  );
}

function TitleCell(props: { task: Telescope.Task; edit: Edit; open: ReactNode }) {
  const { task, edit } = props;
  const [editing, setEditing] = useState<Telescope.Task | null>(null);
  if (editing !== null && edit !== null)
    return (
      <EditInput
        unstyled
        aria-label="任务标题"
        maxLength={Telescope.BOARD_LIMITS.titleLength}
        defaultValue={editing.title}
        onCommit={(value) => {
          setEditing(null);
          const title = value.trim();
          if (title.length > 0) edit(editing, { title });
        }}
        onCancel={() => setEditing(null)}
      />
    );
  const title = <span className="truncate font-medium">{task.title}</span>;
  return (
    <div className="relative flex min-w-0 items-center">
      {edit === null ? (
        <div className={CELL_STATIC}>{title}</div>
      ) : (
        <button
          type="button"
          aria-label={`改标题：${task.title}`}
          className={CELL}
          onClick={() => setEditing(task)}
        >
          {title}
        </button>
      )}
      <span className="shrink-0 pe-2 empty:hidden">
        <NeedsYouBadge task={task} />
      </span>
      {/* Notion's OPEN: hidden until the row is hovered or the link takes focus. */}
      <span className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        {props.open}
      </span>
    </div>
  );
}

/**
 * The open new-task input owns its text and its creates. It stays open while one is out, so a
 * failed title is still there to see; it closes once nothing is out, it has no focus, and it is
 * empty or was cancelled.
 */
function NewTaskInput(props: {
  create: NonNullable<CreateTask>;
  set: Fields | undefined;
  card: boolean;
  onClose: () => void;
}) {
  const pending = useRef(new Set<string>());
  const cancelled = useRef(false);
  const settle = (input: HTMLInputElement) => {
    const idle = pending.current.size === 0 && input !== document.activeElement;
    if (idle && (cancelled.current || input.value.trim() === "")) props.onClose();
  };
  const submit = async (input: HTMLInputElement) => {
    const title = input.value.trim();
    // A second Enter, or a blur right after Enter, must not create the same task again.
    if (title === "" || pending.current.has(title)) return settle(input);
    pending.current.add(title);
    const created = await props.create(title, props.set);
    pending.current.delete(title);
    if (!created) cancelled.current = false;
    else if (input.value.trim() === title) input.value = "";
    settle(input);
  };
  return (
    <Input
      autoFocus
      size="sm"
      unstyled={!props.card}
      aria-label="新任务标题"
      placeholder="要做什么"
      maxLength={Telescope.BOARD_LIMITS.titleLength}
      onFocus={() => (cancelled.current = false)}
      onBlur={(event) =>
        cancelled.current ? settle(event.currentTarget) : void submit(event.currentTarget)
      }
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") void submit(event.currentTarget);
        if (event.key !== "Escape") return;
        cancelled.current = true;
        event.currentTarget.blur();
      }}
    />
  );
}

/** Notion's bottom row: a label until clicked, then a title input that adds a task per Enter. */
function NewTask(props: {
  create: NonNullable<CreateTask>;
  set?: Fields;
  card?: boolean;
  /** Lets a group header's + open the same input; without it the row keeps its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = props.open ?? own;
  const setOpen = props.onOpenChange ?? setOwn;
  if (!open)
    return (
      <button
        type="button"
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.card
            ? "h-10 rounded-xl px-3 text-muted-foreground ring-1 ring-border hover:bg-accent"
            : "h-7 text-foreground hover:bg-accent",
        )}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4 text-muted-foreground" />
        新任务
      </button>
    );
  return (
    <NewTaskInput
      create={props.create}
      set={props.set}
      card={props.card === true}
      onClose={() => setOpen(false)}
    />
  );
}

type Column = "status" | "owner" | "due" | "priority";
const COLUMN = {
  status: { label: "状态", icon: CircleDotDashedIcon, width: "w-32.5", Cell: StatusCell },
  owner: { label: "负责人", icon: UsersIcon, width: "w-43.5", Cell: OwnerCell },
  due: { label: "截止日期", icon: CalendarIcon, width: "w-29.5", Cell: DueCell },
  priority: { label: "优先级", icon: CircleChevronDownIcon, width: "w-26.25", Cell: PriorityCell },
} as const satisfies Record<
  Column,
  { label: string; icon: unknown; width: string; Cell: (props: CellProps) => ReactNode }
>;
/** 我的 shows Notion's My Tasks columns; the other tables show every property. */
const COLUMNS = {
  table: ["status", "owner", "due", "priority"],
  mine: ["owner", "due", "status"],
} as const satisfies Record<string, ReadonlyArray<Column>>;

export function TasksTable(props: {
  target: BoardTarget;
  tasks: ReadonlyArray<Telescope.Task>;
  layout: "table" | "mine";
  mayEdit: boolean;
  create: CreateTask;
  createSet?: Fields;
}) {
  const write = useTaskWrite(props.target);
  const people = useBoardPeople(props.target);
  const project = useTasksProjectId();
  const edit: Edit = props.mayEdit
    ? (task, set) => {
        const keys = Object.keys(set) as ReadonlyArray<Editable>;
        if (keys.some((key) => set[key] !== (task[key] ?? null))) void write(task, { set });
      }
    : null;
  const columns = COLUMNS[props.layout];
  const head = (label: string, Icon: typeof CalendarIcon) => (
    <span className="flex items-center gap-1.5">
      <Icon className="size-4.75 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
  return (
    <div className="overflow-x-auto px-4 pb-6 sm:px-24">
      <table className="w-max table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-88" />
          {columns.map((column) => (
            <col key={column} className={COLUMN[column].width} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="h-9 border-r border-b px-2 font-normal">
              {head("名称", CaseSensitiveIcon)}
            </th>
            {columns.map((column) => (
              <th key={column} className="h-9 border-r border-b px-2 font-normal">
                {head(COLUMN[column].label, COLUMN[column].icon)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.tasks.map((task) => (
            <tr key={task.id} className="group/row">
              <td className="border-r border-b p-0">
                <TitleCell
                  task={task}
                  edit={edit}
                  open={
                    <Button
                      size="xs"
                      variant="outline"
                      render={
                        <Link
                          to={TELESCOPE_PATH}
                          search={telescopeSearch("tasks", props.layout, {
                            task: task.id,
                            project,
                          })}
                        />
                      }
                    >
                      <PanelRightOpenIcon />
                      打开
                    </Button>
                  }
                />
              </td>
              {columns.map((column) => {
                const { Cell } = COLUMN[column];
                return (
                  <td key={column} className="border-r border-b p-0">
                    <Cell task={task} edit={edit} people={people} />
                  </td>
                );
              })}
            </tr>
          ))}
          {props.create === null ? null : (
            <tr>
              <td colSpan={columns.length + 1} className="p-0">
                <NewTask
                  create={props.create}
                  {...(props.createSet ? { set: props.createSet } : {})}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const DRAG_TYPE = "application/x-telescope-task";

function TaskCard(props: {
  task: Telescope.Task;
  people: People;
  project: Telescope.TelescopeProjectId | undefined;
  draggable: boolean;
}) {
  const { task, people } = props;
  const owned = task.ownerSubjectId !== undefined || task.ownerAgentId !== undefined;
  const row = "flex h-7 min-w-0 items-center gap-2 px-2.5 text-xs";
  return (
    <div
      draggable={props.draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "relative flex flex-col rounded-xl bg-card pb-1 shadow-xs ring-1 ring-border",
        props.draggable && "cursor-grab",
      )}
    >
      <Link
        to={TELESCOPE_PATH}
        search={telescopeSearch("tasks", "board", {
          task: task.id,
          project: props.project,
        })}
        draggable={false}
        className="px-2.5 pt-2 pb-1.5 text-sm font-medium wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
      >
        {task.title}
      </Link>
      {task.conflictDecisionId === undefined ? null : (
        <span className={cn(row, "relative z-10 w-fit")}>
          <NeedsYouBadge task={task} />
        </span>
      )}
      {owned ? (
        <span className={row}>
          <Owners task={task} people={people} small />
        </span>
      ) : null}
      {task.priority ? (
        <span className={row}>
          <PriorityTag small priority={task.priority} />
        </span>
      ) : null}
    </div>
  );
}

/** One group per status, Notion-style; a drop is a `task.update` pinned to the card's version. */
export function TasksBoard(props: {
  target: BoardTarget;
  tasks: ReadonlyArray<Telescope.Task>;
  mayEdit: boolean;
  create: CreateTask;
}) {
  const write = useTaskWrite(props.target);
  const people = useBoardPeople(props.target);
  const project = useTasksProjectId();
  const [over, setOver] = useState<Telescope.TaskStatus | null>(null);
  // Each group's input opens and closes on its own, so one group's pending create never closes another's.
  const [adding, setAdding] = useState<Partial<Record<Telescope.TaskStatus, boolean>>>({});
  const columns = tasksByStatus(props.tasks);
  return (
    <div className="flex items-start gap-3 overflow-x-auto px-4 pb-6 sm:px-24">
      {TASK_STATUSES.map((status) => (
        <section key={status} aria-label={TASK_STATUS[status].label} className="w-69 shrink-0">
          <header className="flex h-12 items-center gap-1.5 px-1 text-sm">
            <span
              className={cn(
                "flex h-6.5 items-center gap-1.5 rounded-md px-1",
                STATUS_TONE[status].text,
              )}
            >
              <span className={cn("size-2 rounded-full", STATUS_TONE[status].dot)} />
              {TASK_STATUS[status].label}
            </span>
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-sm px-1.5 tabular-nums",
                STATUS_TONE[status].text,
              )}
            >
              {columns[status].length}
            </span>
            {props.create === null ? null : (
              <Button
                size="icon-xs"
                variant="ghost-muted"
                className="ms-auto"
                aria-label={`新任务（${TASK_STATUS[status].label}）`}
                onClick={() => setAdding((groups) => ({ ...groups, [status]: true }))}
              >
                <PlusIcon />
              </Button>
            )}
          </header>
          <div
            onDragOver={(event) => {
              if (!props.mayEdit || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
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
              "flex flex-col gap-2 rounded-b-xl p-2",
              STATUS_TONE[status].column,
              over === status && "ring-2 ring-primary/40",
            )}
          >
            {columns[status].map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                people={people}
                project={project}
                draggable={props.mayEdit}
              />
            ))}
            {props.create === null ? null : (
              <NewTask
                card
                create={props.create}
                set={{ status }}
                open={adding[status] === true}
                onOpenChange={(open) => setAdding((groups) => ({ ...groups, [status]: open }))}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
