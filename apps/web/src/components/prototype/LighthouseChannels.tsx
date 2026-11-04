// PROTOTYPE, wipe me. Channel pieces for the Telescope chat and agent settings: the tag on a
// message that came from IM or email, the email card and reply draft, the channel filter, the
// per-agent channel switches, and the context meter that shows what the agent has loaded.
import {
  BrainIcon,
  Building2Icon,
  HashIcon,
  MailIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  SendIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  channelLabel,
  channelRows,
  type ChannelId,
  type ChannelOwner,
  type ChannelSet,
} from "./channelStore";

const ICONS = {
  codi: MessageSquareIcon,
  telegram: SendIcon,
  wechat: MessageCircleIcon,
  email: MailIcon,
  slack: HashIcon,
  wecom: Building2Icon,
} as const;

export function ChannelIcon({ id, className }: { id: ChannelId; className?: string }) {
  const Icon = ICONS[id];
  return <Icon aria-hidden className={cn("size-3 shrink-0", className)} />;
}

export function ChannelTag({ id, detail }: { id: ChannelId; detail?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
      <ChannelIcon id={id} />
      <span className="truncate">
        {channelLabel(id)}
        {detail ? ` · ${detail}` : ""}
      </span>
    </span>
  );
}

export function EmailCard({
  from,
  to,
  subject,
  lines,
}: {
  from: string;
  to: string;
  subject: string;
  lines: ReadonlyArray<string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <MailIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{subject}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {from} → {to}
      </div>
      <div className={cn("whitespace-pre-line text-muted-foreground", !open && "line-clamp-2")}>
        {lines.join("\n")}
      </div>
      <div>
        <Button size="xs" variant="ghost-muted" onClick={() => setOpen(!open)}>
          {open ? "收起" : "展开"}
        </Button>
      </div>
    </div>
  );
}

/** Agents never send mail on their own: a reply is a draft until the person sends it. */
export function DraftReply({ to, subject, text }: { to: string; subject: string; text: string }) {
  const [body, setBody] = useState(text);
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={sent ? "success" : "warning"}>{sent ? "已发送" : "草稿"}</Badge>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          回复 {to} · {subject}
        </span>
      </div>
      {editing ? (
        <Textarea
          aria-label="草稿正文"
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
        />
      ) : (
        <div className="whitespace-pre-line">{body}</div>
      )}
      {sent ? (
        <span className="text-xs text-muted-foreground">由你发送 · 已记审计</span>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="xs" onClick={() => setSent(true)}>
            发送
          </Button>
          <Button size="xs" variant="outline" onClick={() => setEditing(!editing)}>
            {editing ? "改好了" : "修改"}
          </Button>
          <span className="text-xs text-muted-foreground">agent 只写草稿，不会自己发出</span>
        </div>
      )}
    </div>
  );
}

const FILTERS = ["all", "codi", "telegram", "wechat", "email"] as const;
export type ChannelFilterValue = (typeof FILTERS)[number];

export function ChannelFilter({
  counts,
  value,
  onChange,
}: {
  counts: Readonly<Partial<Record<ChannelId, number>>>;
  value: ChannelFilterValue;
  onChange: (next: ChannelFilterValue) => void;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <ToggleGroup
      aria-label="按信道看"
      variant="segmented"
      value={[value]}
      onValueChange={(next) => {
        const v = FILTERS.find((f) => f === next[0]);
        if (v) onChange(v);
      }}
    >
      {FILTERS.map((f) => {
        const n = f === "all" ? total : (counts[f] ?? 0);
        return (
          <Toggle key={f} value={f} disabled={n === 0}>
            {f === "all" ? null : <ChannelIcon id={f} />}
            {f === "all" ? "全部" : channelLabel(f)}
            <span className="text-muted-foreground tabular-nums">{n}</span>
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}

/**
 * Switches for one agent's channels. Personal WeChat binds a single agent, so another agent's
 * switch stays off with the reason until that binding is released.
 */
export function ChannelSettings({
  owner,
  value,
  onChange,
  wechatHolder,
}: {
  owner: ChannelOwner;
  value: ChannelSet;
  onChange: (next: ChannelSet) => void;
  /** The name of the viewer's agent that holds WeChat now, when it is not this one. */
  wechatHolder: string | null;
}) {
  const rows = channelRows(owner);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">信道</legend>
      <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
        <ChannelIcon id="codi" className="size-4" />
        <span className="flex-1">Codi（App、网页、桌面）</span>
        <span className="text-xs text-muted-foreground">总是开着</span>
      </div>
      {rows.map((c) => {
        const binding = value[c.id];
        const held = c.id === "wechat" && wechatHolder !== null;
        const disabled = c.unconnected || binding === undefined || held;
        const hint = c.unconnected
          ? "未连接。管理员在服务器设置里接入后才能用"
          : held
            ? `个人微信只能绑一个 agent，现在绑在「${wechatHolder}」上。先在那里关掉`
            : (binding?.handle ?? "");
        return (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-disabled:cursor-not-allowed"
          >
            <ChannelIcon id={c.id} className="size-4" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                {c.label}
                {c.unconnected ? <Badge variant="outline">未连接</Badge> : null}
              </span>
              <span className="text-xs break-all text-muted-foreground">{hint}</span>
            </span>
            <Switch
              checked={!disabled && binding?.on === true}
              disabled={disabled}
              onCheckedChange={(on) =>
                binding && onChange({ ...value, [c.id]: { ...binding, on: Boolean(on) } })
              }
            />
          </label>
        );
      })}
      <ul className="flex list-disc flex-col gap-0.5 ps-5 text-xs text-muted-foreground">
        {owner.kind === "company" ? (
          <li>公司 agents 的信道只有公司管理员能配置；个人微信不给公司 agents。</li>
        ) : (
          <li>个人微信（ClawBot）一个账号只能绑一个 agent。</li>
        )}
        <li>邮件进来先读，回信只写成草稿，发送要人点。</li>
        <li>各信道的消息进同一个对话，按信道标出来源。</li>
      </ul>
    </fieldset>
  );
}

/** Active channels as compact badges, for agent rows and cards. */
export function ChannelBadges({
  value,
  withHandle = false,
}: {
  value: ChannelSet;
  withHandle?: boolean;
}) {
  const on = (Object.keys(value) as Array<ChannelId>).filter((id) => value[id]?.on === true);
  if (on.length === 0) return null;
  return (
    <>
      {on.map((id) => (
        <Badge key={id} variant="outline">
          <ChannelIcon id={id} />
          {channelLabel(id)}
          {withHandle ? ` ${value[id]?.handle ?? ""}` : null}
        </Badge>
      ))}
    </>
  );
}

export interface ContextLoad {
  used: number;
  total: number;
  memories: number;
  parts: ReadonlyArray<{ label: string; detail: string; tokens: number }>;
}

const k = (n: number) => `${Math.round(n / 100) / 10}k`;

/** A static mock of context management: what the agent has loaded for this chat right now. */
export function ContextMeter({ load }: { load: ContextLoad }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="ghost-muted" />}>
        <BrainIcon />
        上下文 {k(load.used)} / {k(load.total)} · 记忆 {load.memories} 条
      </PopoverTrigger>
      <PopoverPopup align="end" aria-label="现在装进上下文的内容">
        <div className="flex w-80 flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="font-medium">现在装进上下文的内容</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, (load.used / load.total) * 100)}%` }}
              />
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {load.parts.map((p) => (
              <li key={p.label} className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span>{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.detail}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {k(p.tokens)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            每个信道的消息都进这一份上下文。旧消息先压成摘要，用到时再从记忆里检索，不整段塞回来。
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
