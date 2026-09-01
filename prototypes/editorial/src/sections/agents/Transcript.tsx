import { useEffect, useRef } from "react";
import { PROVIDERS } from "../../mock/providers";
import { JOIN_NOTE } from "../../mock/replies";
import type { DiffCard, Message, ToolCall } from "../../mock/types";
import { agentById, currentThreadId, toggleTool, useApp } from "../../store/app";
import { shallowEqual } from "../../store/store";
import { IconChevron } from "../../ui/icons";
import { Avatar, cx } from "../../ui/primitives";

const TOOL_KIND_LABEL: Record<ToolCall["kind"], string> = {
  read: "读取",
  edit: "编辑",
  bash: "命令",
  search: "检索",
  test: "测试",
};

/** Splits body text so `@名字` can be rendered as a typographic link. */
function renderBody(text: string, names: string[]) {
  if (names.length === 0) return text;
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join("|")}))`, "g");
  return text.split(pattern).map((part, index) =>
    part.startsWith("@") && names.includes(part.slice(1)) ? (
      <span
        key={index}
        className="font-medium text-ink underline decoration-rule-strong decoration-1 underline-offset-[3px]"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ToolBlock({ call }: { call: ToolCall }) {
  const open = useApp((s) => Boolean(s.expandedTools[call.id]));
  return (
    <div className="overflow-hidden rounded-[10px] border border-rule bg-paper-sunk/50">
      <button
        type="button"
        onClick={() => toggleTool(call.id)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <IconChevron
          className={cx(
            "size-3.5 shrink-0 text-faint transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="eyebrow shrink-0 text-faint">{TOOL_KIND_LABEL[call.kind]}</span>
        <span className="shrink-0 text-[12.5px] text-ink-2">{call.title}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
          {call.target}
        </code>
        <span className="eyebrow shrink-0 text-faint">{call.status === "done" ? "DONE" : "···"}</span>
      </button>
      {open ? (
        <pre className="overflow-x-auto border-t border-rule px-4 py-3 font-mono text-[11.5px] leading-[1.85] text-ink-2">
          {call.output.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function DiffBlock({ diff }: { diff: DiffCard }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-rule bg-card">
      <div className="flex items-baseline gap-3 border-b border-rule px-3.5 py-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{diff.file}</code>
        <span className="num text-[11.5px] text-live">+{diff.added}</span>
        <span className="num text-[11.5px] text-stop">−{diff.removed}</span>
      </div>
      <div className="overflow-x-auto py-1.5">
        <div className="px-3.5 py-1 font-mono text-[11px] text-faint">{diff.hunk}</div>
        {diff.lines.map((line, index) => (
          <div
            key={index}
            className={cx(
              "px-3.5 font-mono text-[11.5px] leading-[1.9] whitespace-pre",
              line.type === "add" && "bg-live/8 text-ink",
              line.type === "del" && "bg-stop/8 text-ink",
              line.type === "ctx" && "text-muted",
            )}
          >
            <span className="mr-2 inline-block w-2 text-faint select-none">
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function JoinRule({ message }: { message: Message }) {
  const name = useApp((s) => agentById(s, message.authorId)?.name ?? "");
  return (
    <div className="flex items-center gap-4 py-7">
      <div className="h-px flex-1 bg-rule" />
      <span className="eyebrow shrink-0 text-faint">
        {name} {JOIN_NOTE}
      </span>
      <div className="h-px flex-1 bg-rule" />
    </div>
  );
}

function MessageBlock({ messageId, names }: { messageId: string; names: string[] }) {
  const message = useApp((s) => s.messages.find((m) => m.id === messageId));
  const author = useApp((s) => agentById(s, message?.authorId));
  const replyTo = useApp((s) => agentById(s, message?.replyToId)?.name);

  if (!message) return null;
  if (message.kind === "join") return <JoinRule message={message} />;

  const isUser = message.authorId === "user";
  const provider = author ? PROVIDERS[author.provider] : undefined;

  return (
    <article className={cx("py-7", replyTo && "border-l border-rule pl-6")}>
      <header className="flex items-baseline gap-3">
        <Avatar glyph={isUser ? "你" : (author?.glyph ?? "?")} size={26} tone={isUser ? "dark" : "light"} />
        <span className="text-[14.5px] font-semibold text-ink">
          {isUser ? "你" : (author?.name ?? "未知")}
        </span>
        {author ? (
          <span className="eyebrow text-faint">
            {author.role} · {provider?.latin}
          </span>
        ) : (
          <span className="eyebrow text-faint">HUMAN</span>
        )}
        {replyTo ? (
          <span className="eyebrow rounded-full border border-rule px-2 py-1 text-muted">
            ↳ 回复 {replyTo}
          </span>
        ) : null}
        <span className="num ml-auto shrink-0 text-[11.5px] text-faint">{message.time}</span>
      </header>

      <div className="mt-3 pl-[38px]">
        {message.toolCalls?.length ? (
          <div className="mb-4 space-y-2">
            {message.toolCalls.map((call) => (
              <ToolBlock key={call.id} call={call} />
            ))}
          </div>
        ) : null}

        <div className="body-cjk max-w-[68ch] text-[14.5px] whitespace-pre-wrap text-ink-2">
          {renderBody(message.text, names)}
          {message.streaming ? <span className="caret ml-0.5" /> : null}
        </div>

        {message.diff ? (
          <div className="mt-4 max-w-[68ch]">
            <DiffBlock diff={message.diff} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function Transcript() {
  const threadId = useApp(currentThreadId);
  const messageIds = useApp(
    (s) => s.messages.filter((m) => m.threadId === threadId).map((m) => m.id),
    shallowEqual,
  );
  const names = useApp(
    (s) => s.agents.filter((a) => a.personaId === s.personaId).map((a) => a.name),
    shallowEqual,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const seen = useRef({ threadId, count: messageIds.length });

  // Follow the tail when a message is appended, but never on mount or on a
  // thread switch — landing mid-page would hide the section header.
  useEffect(() => {
    const previous = seen.current;
    seen.current = { threadId, count: messageIds.length };
    if (previous.threadId !== threadId) return;
    if (messageIds.length <= previous.count) return;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messageIds.length, threadId]);

  return (
    <div className="divide-y divide-rule">
      {messageIds.map((id) => (
        <MessageBlock key={id} messageId={id} names={names} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
