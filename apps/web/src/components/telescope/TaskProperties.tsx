import type { Telescope } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { TASK_STATUS } from "./TasksParts";

const TONE = {
  error: "bg-destructive/12 text-destructive-foreground dark:bg-destructive/32",
  warning: "bg-warning/16 text-warning-foreground dark:bg-warning/32",
  success: "bg-success/16 text-success-foreground dark:bg-success/32",
};

/** Notion-style property values shared by the task table and board; display only. */
export const STATUS_TONE = {
  todo: {
    pill: "bg-foreground/10 text-foreground",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    column: "bg-foreground/3",
  },
  in_progress: {
    pill: "bg-info/16 text-info-foreground dark:bg-info/32",
    dot: "bg-info",
    text: "text-info-foreground",
    column: "bg-info/6",
  },
  in_review: {
    pill: TONE.warning,
    dot: "bg-warning",
    text: "text-warning-foreground",
    column: "bg-warning/6",
  },
  done: {
    pill: TONE.success,
    dot: "bg-success",
    text: "text-success-foreground",
    column: "bg-success/5",
  },
  needs_decision: {
    pill: TONE.error,
    dot: "bg-destructive",
    text: "text-destructive-foreground",
    column: "bg-destructive/5",
  },
  dropped: {
    pill: "bg-foreground/6 text-muted-foreground",
    dot: "bg-muted-foreground/60",
    text: "text-muted-foreground",
    column: "bg-foreground/2",
  },
} as const satisfies Record<
  Telescope.TaskStatus,
  { pill: string; dot: string; text: string; column: string }
>;

export function StatusPill({ status }: { status: Telescope.TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full ps-1.5 pe-2 text-sm whitespace-nowrap",
        STATUS_TONE[status].pill,
      )}
    >
      <span className={cn("size-2 rounded-full", STATUS_TONE[status].dot)} />
      {TASK_STATUS[status].label}
    </span>
  );
}

const TASK_PRIORITY = {
  high: { label: "高", tag: TONE.error },
  medium: { label: "中", tag: TONE.warning },
  low: { label: "低", tag: TONE.success },
} as const satisfies Record<Telescope.TaskPriority, { label: string; tag: string }>;

export function PriorityTag(props: { priority: Telescope.TaskPriority; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 whitespace-nowrap",
        props.small ? "h-4.5 text-xs" : "h-5 text-sm",
        TASK_PRIORITY[props.priority].tag,
      )}
    >
      {TASK_PRIORITY[props.priority].label}
    </span>
  );
}

/** A member shows their initial; an agent shows a bot, so the two never read alike. */
export function PersonChip(props: { name: string; agent?: boolean; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        props.small ? "text-xs" : "text-sm",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs text-muted-foreground",
          props.small ? "size-4.5" : "size-5",
        )}
      >
        {props.agent ? <BotIcon className="size-3" /> : props.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="truncate">{props.name}</span>
    </span>
  );
}

const DAY = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

/** `YYYY-MM-DD` has no time zone; read and print it in UTC so the day never shifts. */
export const formatDueDate = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));
