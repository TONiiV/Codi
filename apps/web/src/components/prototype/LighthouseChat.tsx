// PROTOTYPE, wipe me. Chat surfaces in the Code look: assistant text without a bubble, user
// messages in a right-aligned bubble, and the Code composer card with a round send button.
import { PaperclipIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { ComposerSurface } from "../chat/ComposerSurface";
import { Button } from "../ui/button";
import { ChannelTag } from "./LighthouseChannels";
import type { ChannelId } from "./channelStore";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  author?: string;
  body: ReactNode;
  /** Where the message came in or goes out; absent means the Codi app. */
  channel?: ChannelId;
  via?: string;
}

function Via({ m }: { m: ChatMessage }) {
  return m.channel && m.channel !== "codi" ? (
    <ChannelTag id={m.channel} {...(m.via ? { detail: m.via } : {})} />
  ) : null;
}

export function ChatTimeline({ messages }: { messages: ReadonlyArray<ChatMessage> }) {
  return (
    <div className="flex flex-col">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex flex-col items-end gap-1 pb-4">
            <Via m={m} />
            <div className="max-w-[80%] min-w-0 rounded-2xl bg-message p-3 text-sm leading-relaxed text-message-foreground">
              {m.body}
            </div>
          </div>
        ) : (
          <div key={m.id} className="relative min-w-0 px-1 py-0.5 pb-4">
            {m.author || m.channel ? (
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {m.author}
                <Via m={m} />
              </div>
            ) : null}
            <div className="text-sm leading-relaxed">{m.body}</div>
          </div>
        ),
      )}
    </div>
  );
}

function SendGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChatComposerCard({
  placeholder,
  label,
  gauge,
  className,
  onSend,
  autoFocus,
}: {
  placeholder: string;
  label?: ReactNode;
  gauge?: ReactNode;
  className?: string;
  /** Enter or the send button hands over the trimmed text and clears the box. */
  onSend?: (text: string) => void;
  autoFocus?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const text = box.current?.value.trim();
    if (!onSend || !box.current || !text) return;
    onSend(text);
    box.current.value = "";
  };
  return (
    <ComposerSurface.Shell className={className}>
      <ComposerSurface.Host>
        <ComposerSurface.Main>
          <textarea
            ref={box}
            rows={2}
            autoFocus={autoFocus}
            aria-label={placeholder}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              send();
            }}
            placeholder={placeholder}
            className="block max-h-52 min-h-14 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex min-w-0 items-center px-2 pb-2">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach files">
              <PaperclipIcon className="translate-y-px" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              {label ? (
                <span className="truncate text-xs text-muted-foreground">{label}</span>
              ) : null}
              {gauge}
              <button
                type="button"
                aria-label="Send"
                onClick={send}
                className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs transition-transform hover:scale-105 hover:bg-message-action-hover"
              >
                <SendGlyph />
              </button>
            </div>
          </div>
        </ComposerSurface.Main>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>
  );
}
