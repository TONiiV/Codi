import { useMemo, useRef, useState } from "react";
import { PROVIDER_ORDER, PROVIDERS, STATUS_LABEL } from "../../mock/providers";
import type { ProviderId } from "../../mock/types";
import {
  agentById,
  agentsFor,
  currentThreadId,
  leadAgentId,
  sendMessage,
  setAgentModel,
  setAgentProvider,
  useApp,
} from "../../store/app";
import { shallowEqual } from "../../store/store";
import { IconAt, IconSend } from "../../ui/icons";
import { Avatar, cx, Selector } from "../../ui/primitives";

/** Matches a `@partial` token the caret is currently sitting inside. */
function mentionQueryAt(value: string, caret: number): string | null {
  const head = value.slice(0, caret);
  const match = /@([^\s@]*)$/.exec(head);
  return match ? match[1]! : null;
}

export function Composer() {
  const threadId = useApp(currentThreadId);
  const busy = useApp((s) => Boolean(s.busyThreads[currentThreadId(s)]));
  const roster = useApp((s) => agentsFor(s, s.personaId), shallowEqual);
  const lead = useApp((s) => agentById(s, leadAgentId(s, currentThreadId(s))));

  const [value, setValue] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return roster
      .filter(
        (agent) =>
          !q || agent.name.toLowerCase().includes(q) || agent.latin.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, roster]);

  const sync = (next: string, caret: number) => {
    setValue(next);
    const found = mentionQueryAt(next, caret);
    setQuery(found);
    setCursor(0);
  };

  const insertMention = (name: string) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const head = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${name} `);
    const next = head + value.slice(caret);
    setValue(next);
    setQuery(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(head.length, head.length);
    });
  };

  const submit = () => {
    if (busy || !value.trim()) return;
    sendMessage(value);
    setValue("");
    setQuery(null);
  };

  const provider = lead ? PROVIDERS[lead.provider] : undefined;

  return (
    <div className="relative">
      {query !== null && matches.length > 0 ? (
        <div className="absolute bottom-[calc(100%+10px)] left-0 z-20 w-[320px] overflow-hidden rounded-[12px] border border-rule bg-card shadow-[0_18px_40px_-20px_rgba(22,19,15,0.4)]">
          <div className="eyebrow border-b border-rule px-4 py-2.5 text-faint">呼叫智能体</div>
          {matches.map((agent, index) => (
            <button
              key={agent.id}
              type="button"
              onMouseEnter={() => setCursor(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(agent.name);
              }}
              className={cx(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                index === cursor && "bg-paper-sunk",
              )}
            >
              <Avatar glyph={agent.glyph} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink">{agent.name}</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                  {agent.role} · {PROVIDERS[agent.provider].label}
                </span>
              </span>
              <span className="eyebrow shrink-0 text-faint">{STATUS_LABEL[agent.status]}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-[14px] border border-rule bg-card">
        <textarea
          ref={inputRef}
          value={value}
          rows={3}
          disabled={!threadId}
          onChange={(event) => sync(event.target.value, event.target.selectionStart)}
          onKeyUp={(event) => {
            const target = event.currentTarget;
            setQuery(mentionQueryAt(target.value, target.selectionStart));
          }}
          onKeyDown={(event) => {
            if (query !== null && matches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, matches.length - 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(matches[cursor]!.name);
                return;
              }
              if (event.key === "Escape") {
                setQuery(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            busy ? "智能体正在回复……" : "说点什么。输入 @ 可以把别的智能体拉进这条对话。"
          }
          className="body-cjk w-full resize-none bg-transparent px-5 pt-4 text-[14.5px] text-ink outline-none placeholder:text-faint"
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3">
          {lead ? (
            <>
              <span className="eyebrow pr-1 text-faint">主答</span>
              <span className="text-[12.5px] text-ink">{lead.name}</span>
              <Selector<ProviderId>
                label="PROVIDER"
                value={lead.provider}
                options={PROVIDER_ORDER.map((id) => ({ value: id, label: PROVIDERS[id].label }))}
                onChange={(next) => setAgentProvider(lead.id, next, PROVIDERS[next].models[0]!)}
              />
              <Selector
                label="MODEL"
                value={lead.model}
                options={(provider?.models ?? []).map((model) => ({ value: model, label: model }))}
                onChange={(next) => setAgentModel(lead.id, next)}
              />
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[11.5px] text-faint sm:flex">
              <IconAt className="size-3.5" />@ 呼叫 · Enter 发送
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !value.trim()}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-ink px-4 py-1.5 text-[12.5px] text-paper transition-opacity disabled:cursor-not-allowed disabled:opacity-25"
            >
              发送
              <IconSend className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
