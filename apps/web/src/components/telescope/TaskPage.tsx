import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskList";
import { Telescope } from "@t3tools/contracts";
import {
  ArrowUpIcon,
  CalendarIcon,
  CircleDotIcon,
  FlagIcon,
  type LucideIcon,
  UserRoundIcon,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { NeedsYouBadge, TASK_STATUS, type useTaskWrite } from "./TasksParts";

type Write = ReturnType<typeof useTaskWrite>;
type Task = Telescope.Task;
type Names = (id: string) => string | undefined;
type Agents = ReadonlyArray<{ readonly id: Telescope.AgentId; readonly name: string }>;

export const time = (at: string) => new Date(at).toLocaleString();
const composing = (event: KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229;

/** A value a control sent stands in for the task's own until the task's next version arrives. */
function useSent<V>(
  task: Task,
  write: Write | null,
  current: V,
  change: (value: V) => Telescope.TaskFields,
) {
  const [sent, setSent] = useState<{ value: V; version: number } | null>(null);
  const value = sent?.version === task.version ? sent.value : current;
  const send = async (next: V, base: Task = task) => {
    if (write === null || next === value) return true;
    setSent({ value: next, version: task.version });
    const saved = await write(base, { set: change(next) });
    if (!saved) setSent(null);
    return saved;
  };
  return [value, send] as const;
}

/** A pinned property: a label row over its value, as on a Notion task page. */
function Property(props: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="telescope-task-label flex h-6 items-center gap-1.5 px-1.5 font-medium text-muted-foreground">
        <props.icon className="size-4.25" />
        {props.label}
      </div>
      <div className="flex min-h-7.5 items-center gap-1.5 px-1.5 text-sm">{props.children}</div>
    </div>
  );
}

/** A row of the details list: a 120px label cell beside its value. */
export function PropertyRow(props: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8.5 items-start text-sm">
      <div className="flex h-8.5 w-30 shrink-0 items-center gap-1.5 px-1.5 text-muted-foreground">
        <props.icon className="size-4.75" />
        {props.label}
      </div>
      <div className="flex min-h-8.5 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 px-1.5">
        {props.children}
      </div>
    </div>
  );
}

const Empty = () => <span className="text-muted-foreground">空</span>;

const PRIORITY = {
  high: { label: "高", badge: "error" },
  medium: { label: "中", badge: "warning" },
  low: { label: "低", badge: "secondary" },
} as const satisfies Record<Telescope.TaskPriority, { label: string; badge: string }>;

function PriorityBadge({ priority }: { priority: Telescope.TaskPriority | undefined }) {
  if (priority === undefined) return <Empty />;
  return (
    <Badge variant={PRIORITY[priority].badge} size="cell">
      {PRIORITY[priority].label}
    </Badge>
  );
}

/** Calendar day in the viewer's locale; `YYYY-MM-DD` read as a local date, not UTC midnight. */
const dayLabel = (day: string) => new Date(`${day}T00:00`).toLocaleDateString();

function Title({ task, write }: { task: Task; write: Write | null }) {
  // The task as editing began: a rename arriving meanwhile leaves the typed text alone and
  // the write goes in against that version, so the server reports what it replaced.
  const [base, setBase] = useState<Task | null>(null);
  const shown = base ?? task;
  const className = "telescope-task-title font-bold wrap-anywhere outline-none";
  if (write === null) return <h1 className={className}>{task.title}</h1>;
  const save = async (element: HTMLElement) => {
    setBase(null);
    const title = (element.textContent ?? "").trim().slice(0, Telescope.BOARD_LIMITS.titleLength);
    if (title.length === 0 || title === shown.title) element.textContent = task.title;
    // A refused title stays as typed, beside the error toast, like the other controls.
    else await write(shown, { set: { title } });
  };
  return (
    <h1
      // A new title from the server remounts the text the browser owns, once editing ends.
      key={shown.title}
      role="textbox"
      aria-label="任务标题"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      className={className}
      onFocus={() => setBase(task)}
      onBlur={(event) => void save(event.currentTarget)}
      onKeyDown={(event) => {
        if (composing(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.textContent = shown.title;
          event.currentTarget.blur();
        }
      }}
    >
      {shown.title}
    </h1>
  );
}

/** A property edited in place with a select; read-only, just its display. */
function ValueSelect<V extends string>(props: {
  label: string;
  value: V | null;
  editable: boolean;
  onChange: (value: V | null) => void;
  display: ReactNode;
  children: ReactNode;
}) {
  if (!props.editable) return props.display;
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger variant="ghost" size="cell" className="-mx-1.5" aria-label={props.label}>
        <SelectValue>{props.display}</SelectValue>
      </SelectTrigger>
      <SelectPopup>{props.children}</SelectPopup>
    </Select>
  );
}

function StatusValue({ task, write }: { task: Task; write: Write | null }) {
  const [status, send] = useSent(task, write, task.status, (status) => ({ status }));
  return (
    <ValueSelect
      label="状态"
      value={status}
      editable={write !== null}
      onChange={(next) => next !== null && void send(next)}
      display={
        <Badge variant={TASK_STATUS[status].badge} size="cell">
          {TASK_STATUS[status].label}
        </Badge>
      }
    >
      {Telescope.TaskStatus.literals.map((status) => (
        <SelectItem key={status} value={status}>
          {TASK_STATUS[status].label}
        </SelectItem>
      ))}
    </ValueSelect>
  );
}

function OwnerValue(props: { task: Task; write: Write | null; names: Names; agents: Agents }) {
  const { task, write, names } = props;
  const [owner, send] = useSent(task, write, task.ownerAgentId ?? null, (ownerAgentId) => ({
    ownerAgentId,
  }));
  const ownerName = owner && (names(owner) ?? "其他成员的 agent");
  return (
    <ValueSelect
      label="负责"
      value={owner}
      editable={write !== null}
      onChange={(next) => void send(next)}
      display={ownerName ? <span>{ownerName}</span> : <Empty />}
    >
      <SelectItem value={null}>无</SelectItem>
      {props.agents.map((agent) => (
        <SelectItem key={agent.id} value={agent.id}>
          {agent.name}
        </SelectItem>
      ))}
    </ValueSelect>
  );
}

function DueDateValue({ task, write }: { task: Task; write: Write | null }) {
  const [dueDate, send] = useSent(task, write, task.dueDate ?? null, (dueDate) => ({ dueDate }));
  // ponytail: a year being typed emits 0002, 0020, 0202 first; it stays here until plausible.
  const [partial, setPartial] = useState<string | null>(null);
  if (write === null) return dueDate ? <span>{dayLabel(dueDate)}</span> : <Empty />;
  return (
    <Input
      type="date"
      variant="ghost"
      size="cell"
      className="-mx-1.5"
      aria-label="截止日期"
      value={partial ?? dueDate ?? ""}
      onChange={(event) => {
        const value = event.target.value;
        const typing = value !== "" && Number(value.slice(0, 4)) < 1900;
        setPartial(typing ? value : null);
        if (!typing) void send(value === "" ? null : value);
      }}
    />
  );
}

function PriorityValue({ task, write }: { task: Task; write: Write | null }) {
  const [priority, send] = useSent(task, write, task.priority ?? null, (priority) => ({
    priority,
  }));
  return (
    <ValueSelect
      label="优先级"
      value={priority}
      editable={write !== null}
      onChange={(next) => void send(next)}
      display={<PriorityBadge priority={priority ?? undefined} />}
    >
      <SelectItem value={null}>无</SelectItem>
      {Telescope.TaskPriority.literals.map((priority) => (
        <SelectItem key={priority} value={priority}>
          {PRIORITY[priority].label}
        </SelectItem>
      ))}
    </ValueSelect>
  );
}

function Initial({ name }: { name: string }) {
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The task's append-only notes; a new one goes out as `note`, signed by the server. */
function Comments(props: { task: Task; write: Write | null; names: Names; selfName: string }) {
  const { task, write, names } = props;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const note = draft.trim();
    if (write === null || sending || note.length === 0) return;
    setSending(true);
    // Text typed while the note was in flight stays in the box.
    if (await write(task, { note }))
      setDraft((now) => (now.startsWith(draft) ? now.slice(draft.length) : now));
    setSending(false);
  };
  return (
    <section aria-label="评论" className="flex flex-col gap-3 border-b pb-4">
      <h2 className="telescope-task-label font-medium text-muted-foreground">评论</h2>
      {task.freeText.length === 0 ? null : (
        <ol className="flex flex-col gap-3">
          {task.freeText.map((entry) => {
            const author = names(entry.authorId) ?? "其他成员";
            return (
              <li key={`${entry.at}-${entry.authorId}`} className="flex gap-2">
                <Initial name={author} />
                <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <p>
                    <span className="font-medium">{author}</span>
                    <span className="ms-2 text-muted-foreground text-xs">{time(entry.at)}</span>
                  </p>
                  <p className="whitespace-pre-wrap wrap-anywhere">{entry.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {write === null ? null : (
        <div className="flex items-start gap-2">
          <Initial name={props.selfName} />
          <Textarea
            size="sm"
            rows={1}
            aria-label="添加评论"
            placeholder="添加评论…"
            maxLength={Telescope.BOARD_LIMITS.noteLength}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (composing(event) || event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              void send();
            }}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="发送评论"
            disabled={sending || draft.trim().length === 0}
            onClick={() => void send()}
          >
            <ArrowUpIcon />
          </Button>
        </div>
      )}
    </section>
  );
}

// Notion's block sizes; chat markdown's own heading rules sit outside the utility layer.
const BODY_TYPE =
  "text-base leading-6 [&_h1]:text-3xl! [&_h1]:leading-9.75! [&_h2]:text-2xl! [&_h2]:leading-8! [&_h3]:text-xl! [&_h3]:leading-6.5! [&_.task-list-item_input]:size-4";

/** The markdown body: checkboxes tick in place, and editing is the plain source. */
function Body({ task, write }: { task: Task; write: Write | null }) {
  // The source is saved against the task it was opened on, so the server reports what it replaced.
  const [editing, setEditing] = useState<{ task: Task; body: string; source: string } | null>(null);
  const [body, save] = useSent(task, write, task.body ?? "", (body) => ({
    body: body.trim().length === 0 ? null : body,
  }));
  if (editing !== null)
    return (
      <section aria-label="正文" className="flex flex-col gap-2">
        <Textarea
          autoFocus
          aria-label="正文 Markdown"
          maxLength={Telescope.BOARD_LIMITS.bodyLength}
          value={editing.source}
          onChange={(event) => setEditing({ ...editing, source: event.target.value })}
        />
        <div className="flex gap-2">
          <Button
            size="xs"
            onClick={async () => {
              const { source } = editing;
              if (source === editing.body || (await save(source, editing.task))) setEditing(null);
            }}
          >
            保存
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
            取消
          </Button>
        </div>
      </section>
    );
  return (
    <section aria-label="正文" className="flex flex-col">
      {write === null ? null : (
        <Button
          size="xs"
          variant="ghost-muted"
          className="self-end"
          onClick={() => setEditing({ task, body, source: body })}
        >
          编辑 Markdown
        </Button>
      )}
      {body.trim().length === 0 ? (
        <p className="text-base text-muted-foreground">还没有正文</p>
      ) : (
        <ChatMarkdown
          text={body}
          cwd={undefined}
          className={BODY_TYPE}
          onTaskListChange={
            write === null
              ? undefined
              : ({ markerOffset, checked }) => {
                  void save(setMarkdownTaskChecked(body, markerOffset, checked));
                }
          }
        />
      )}
    </section>
  );
}

/**
 * The task as a Notion-style page: title, pinned properties, comments, then the body.
 * `write` is null for a member who may not edit, and every control goes with it.
 */
export function TaskPage(props: {
  task: Task;
  write: Write | null;
  names: Names;
  agents: Agents;
  selfName: string;
  /** More rows for the details list, after priority. */
  details?: ReactNode;
  /** Sections after the body. */
  children?: ReactNode;
}) {
  const { task, write, names } = props;
  const [details, setDetails] = useState(false);
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-6 px-6 pt-9 pb-16 @2xl:ps-19 @2xl:pe-23">
        <div className="flex flex-col gap-3">
          <Title task={task} write={write} />
          <Button
            size="sm"
            variant="ghost-muted"
            className="-mx-2.25 self-start"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            {details ? "隐藏详情" : "查看详情"}
          </Button>
          <div className="-mx-1.5 flex flex-wrap gap-x-2 gap-y-1">
            <Property icon={UserRoundIcon} label="负责">
              <OwnerValue task={task} write={write} names={names} agents={props.agents} />
            </Property>
            <Property icon={CircleDotIcon} label="状态">
              <StatusValue task={task} write={write} />
              <NeedsYouBadge task={task} />
            </Property>
            <Property icon={CalendarIcon} label="截止日期">
              <DueDateValue task={task} write={write} />
            </Property>
          </div>
          {details ? (
            <section aria-label="属性" className="-mx-1.5 flex flex-col gap-1">
              <h2 className="telescope-task-label px-1.5 font-medium text-muted-foreground">
                属性
              </h2>
              <PropertyRow icon={FlagIcon} label="优先级">
                <PriorityValue task={task} write={write} />
              </PropertyRow>
              {props.details}
            </section>
          ) : null}
        </div>
        <Comments task={task} write={write} names={names} selfName={props.selfName} />
        <Body task={task} write={write} />
        {props.children}
      </div>
    </div>
  );
}
