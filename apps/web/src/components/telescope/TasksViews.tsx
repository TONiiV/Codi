import { TASK_STATUSES, tasksByStatus } from "@t3tools/client-runtime/telescope/taskBoard";
import { Telescope } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
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

type Write = ReturnType<typeof useTaskWrite>;
type People = ReturnType<typeof useBoardPeople>;
type Fields = NonNullable<Parameters<Write>[1]["set"]>;
/** Creates a task in the view's project; null for a member who may not. */
export type CreateTask = ((title: string, set?: Fields) => Promise<boolean>) | null;
/** Null for a member who may not edit. */
type Edit = ((task: Telescope.Task, set: Fields) => void) | null;

const PRIORITIES = [
  "high",
  "medium",
  "low",
] as const satisfies ReadonlyArray<Telescope.TaskPriority>;
const NONE = "";

const CELL =
  "flex h-9 w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden px-2 text-left whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const CELL_STATIC = "flex h-9 min-w-0 items-center gap-1.5 overflow-hidden px-2 whitespace-nowrap";

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

function StatusCell({ task, edit }: { task: Telescope.Task; edit: Edit }) {
  return (
    <MenuCell label="状态" edit={edit !== null} value={<StatusPill status={task.status} />}>
      <MenuRadioGroup value={task.status}>
        {Telescope.TaskStatus.literals.map((status) => (
          <MenuRadioItem
            key={status}
            value={status}
            closeOnClick
            onClick={() => status !== task.status && edit?.(task, { status })}
          >
            <StatusPill status={status} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuCell>
  );
}

function PriorityCell({ task, edit }: { task: Telescope.Task; edit: Edit }) {
  const pick = (priority: Telescope.TaskPriority | null) =>
    priority !== (task.priority ?? null) && edit?.(task, { priority });
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
        {PRIORITIES.map((priority) => (
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

function OwnerCell({ task, edit, people }: { task: Telescope.Task; edit: Edit; people: People }) {
  return (
    <MenuCell label="负责人" edit={edit !== null} value={<Owners task={task} people={people} />}>
      <MenuGroup>
        <MenuGroupLabel>成员</MenuGroupLabel>
        <MenuRadioGroup value={task.ownerSubjectId ?? NONE}>
          <MenuRadioItem
            value={NONE}
            closeOnClick
            onClick={() => task.ownerSubjectId && edit?.(task, { ownerSubjectId: null })}
          >
            <span className="text-muted-foreground">无</span>
          </MenuRadioItem>
          {people.members.map((member) => (
            <MenuRadioItem
              key={member.subjectId}
              value={member.subjectId}
              closeOnClick
              onClick={() =>
                member.subjectId !== task.ownerSubjectId &&
                edit?.(task, { ownerSubjectId: member.subjectId })
              }
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
            onClick={() => task.ownerAgentId && edit?.(task, { ownerAgentId: null })}
          >
            <span className="text-muted-foreground">无</span>
          </MenuRadioItem>
          {people.agents.map((agent) => (
            <MenuRadioItem
              key={agent.id}
              value={agent.id}
              closeOnClick
              onClick={() =>
                agent.id !== task.ownerAgentId && edit?.(task, { ownerAgentId: agent.id })
              }
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
 * input as it unmounts; that blur must not commit again. `stay` keeps it open after Enter.
 */
function EditInput({
  onCommit,
  onCancel,
  stay = false,
  ...props
}: Omit<InputProps, "onBlur" | "onKeyDown"> & {
  onCommit: (value: string, input: HTMLInputElement) => void;
  onCancel: () => void;
  stay?: boolean;
}) {
  const settled = useRef(false);
  return (
    <Input
      {...props}
      autoFocus
      size="sm"
      onBlur={(event) => {
        if (!settled.current) onCommit(event.currentTarget.value, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key !== "Enter" && event.key !== "Escape") return;
        settled.current = event.key === "Escape" || !stay;
        if (event.key === "Enter") onCommit(event.currentTarget.value, event.currentTarget);
        else onCancel();
      }}
    />
  );
}

/** Shows the day; a click swaps in the native date input. */
function DueCell({ task, edit }: { task: Telescope.Task; edit: Edit }) {
  const [editing, setEditing] = useState(false);
  const shown = task.dueDate && formatDueDate(task.dueDate);
  if (edit === null) return <div className={CELL_STATIC}>{shown}</div>;
  if (!editing)
    return (
      <button type="button" aria-label="截止日期" className={CELL} onClick={() => setEditing(true)}>
        {shown}
      </button>
    );
  return (
    <EditInput
      unstyled
      nativeInput
      type="date"
      aria-label="截止日期"
      defaultValue={task.dueDate ?? ""}
      onFocus={(event) => {
        try {
          event.currentTarget.showPicker();
        } catch {
          // Without the click's activation the picker stays shut; typing still works.
        }
      }}
      onCommit={(value) => {
        setEditing(false);
        if (value !== (task.dueDate ?? "")) edit(task, { dueDate: value === "" ? null : value });
      }}
      onCancel={() => setEditing(false)}
    />
  );
}

function TitleCell(props: { task: Telescope.Task; edit: Edit; open: ReactNode }) {
  const { task, edit } = props;
  const [editing, setEditing] = useState(false);
  if (editing && edit !== null)
    return (
      <EditInput
        unstyled
        aria-label="任务标题"
        maxLength={Telescope.BOARD_LIMITS.titleLength}
        defaultValue={task.title}
        onCommit={(value) => {
          setEditing(false);
          const title = value.trim();
          if (title.length > 0 && title !== task.title) edit(task, { title });
        }}
        onCancel={() => setEditing(false)}
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
          onClick={() => setEditing(true)}
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

/** Notion's bottom row: a label until clicked, then a title input that adds a task per Enter. */
function NewTask(props: { create: NonNullable<CreateTask>; set?: Fields; card?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.card
            ? "h-10 rounded-xl text-muted-foreground ring-1 ring-border hover:bg-accent"
            : "h-7 text-foreground hover:bg-accent",
        )}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4 text-muted-foreground" />
        新任务
      </button>
    );
  return (
    <EditInput
      stay
      unstyled={!props.card}
      aria-label="新任务标题"
      placeholder="要做什么"
      maxLength={Telescope.BOARD_LIMITS.titleLength}
      onCommit={async (value, input) => {
        const title = value.trim();
        if (title.length > 0 && (await props.create(title, props.set))) input.value = "";
        if (input !== document.activeElement) setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

type Column = "status" | "owner" | "due" | "priority";
const COLUMN = {
  status: { label: "状态", icon: CircleDotDashedIcon, width: "w-32.5" },
  owner: { label: "负责人", icon: UsersIcon, width: "w-43.5" },
  due: { label: "截止日期", icon: CalendarIcon, width: "w-32" },
  priority: { label: "优先级", icon: CircleChevronDownIcon, width: "w-26.25" },
} as const satisfies Record<Column, { label: string; icon: unknown; width: string }>;
/** 我的 shows Notion's My Tasks columns; the other tables show every property. */
const COLUMNS = {
  table: ["status", "owner", "due", "priority"],
  mine: ["owner", "due", "status"],
} as const satisfies Record<string, ReadonlyArray<Column>>;

const editOf = (write: Write, mayEdit: boolean): Edit =>
  mayEdit ? (task, set) => void write(task, { set }) : null;

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
  const edit = editOf(write, props.mayEdit);
  const columns = COLUMNS[props.layout];
  const head = (label: string, Icon: typeof CalendarIcon) => (
    <span className="flex items-center gap-1.5">
      <Icon className="size-4.5 shrink-0" />
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
              {columns.map((column) => (
                <td key={column} className="border-r border-b p-0">
                  {column === "status" ? (
                    <StatusCell task={task} edit={edit} />
                  ) : column === "owner" ? (
                    <OwnerCell task={task} edit={edit} people={people} />
                  ) : column === "due" ? (
                    <DueCell task={task} edit={edit} />
                  ) : (
                    <PriorityCell task={task} edit={edit} />
                  )}
                </td>
              ))}
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
        className="px-2.5 pt-2 pb-1 text-sm font-medium wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
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
      {task.dueDate ? <span className={row}>{formatDueDate(task.dueDate)}</span> : null}
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
            <span className={cn("tabular-nums", STATUS_TONE[status].text)}>
              {columns[status].length}
            </span>
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
            {props.create === null ? null : <NewTask card create={props.create} set={{ status }} />}
          </div>
        </section>
      ))}
    </div>
  );
}
