import * as React from "react";
import * as Schema from "effect/Schema";
import type { TFunction } from "i18next";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@t3tools/shared/composerContextClipboard";
import { englishT } from "~/i18n/englishT";
import { useTranslation } from "react-i18next";
import { useStableCallback } from "./useStableCallback";

function clipboardMessage(t: TFunction, key: string, fallback: string, target: string): string {
  return t(`settings.parallelShared.${key}`, { defaultValue: fallback, target });
}

export class ClipboardApiUnavailableError extends Schema.TaggedError<ClipboardApiUnavailableError>()(
  "ClipboardApiUnavailableError",
  {
    target: Schema.String,
    messageText: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.messageText ?? `Clipboard API is unavailable while copying ${this.target}.`;
  }
}

export class ClipboardWriteError extends Schema.TaggedError<ClipboardWriteError>()(
  "ClipboardWriteError",
  {
    target: Schema.String,
    cause: Schema.Defect(),
    messageText: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.messageText ?? `Failed to copy ${this.target} to the clipboard.`;
  }
}

export class ClipboardReadUnavailableError extends Schema.TaggedError<ClipboardReadUnavailableError>()(
  "ClipboardReadUnavailableError",
  {
    target: Schema.String,
    messageText: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.messageText ?? `Clipboard API is unavailable while reading ${this.target}.`;
  }
}

export class ClipboardReadError extends Schema.TaggedError<ClipboardReadError>()(
  "ClipboardReadError",
  {
    target: Schema.String,
    cause: Schema.Defect(),
    messageText: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.messageText ?? `Failed to read ${this.target} from the clipboard.`;
  }
}

function writeTextWithExecCommand(
  value: string,
  extraFlavors?: Readonly<Record<string, string>>,
): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.fontSize = "16px";

  const previouslyFocused = document.activeElement;
  const copy = (event: ClipboardEvent) => {
    if (!extraFlavors || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", value);
    for (const [type, data] of Object.entries(extraFlavors))
      event.clipboardData.setData(type, data);
    event.preventDefault();
  };
  document.body.appendChild(textarea);
  textarea.addEventListener("copy", copy);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.removeEventListener("copy", copy);
    textarea.remove();
    const restoreFocus = (previouslyFocused as { focus?: unknown } | null)?.focus;
    if (typeof restoreFocus === "function") {
      restoreFocus.call(previouslyFocused);
    }
  }
}

export async function writeTextToClipboard(
  value: string,
  target = "text",
  extraFlavors?: Readonly<Record<string, string>>,
  t: TFunction = englishT,
) {
  if (typeof window === "undefined") {
    throw new ClipboardApiUnavailableError({
      target,
      messageText: clipboardMessage(
        t,
        "copyUnavailable",
        "Clipboard API is unavailable while copying {{target}}.",
        target,
      ),
    });
  }

  if (!value) return false;
  if (extraFlavors) {
    extraFlavors = Object.fromEntries(
      Object.entries(extraFlavors).filter(([type]) => type !== "text/plain"),
    );
  }
  const contextFragment = extraFlavors?.[COMPOSER_CONTEXT_CLIPBOARD_MIME];
  if (contextFragment)
    extraFlavors = {
      ...extraFlavors,
      "text/html": encodeComposerContextClipboardHtml(
        value,
        contextFragment,
        extraFlavors?.["text/html"],
      ),
    };

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    if (writeTextWithExecCommand(value, extraFlavors)) return true;
    throw new ClipboardApiUnavailableError({
      target,
      messageText: clipboardMessage(
        t,
        "copyUnavailable",
        "Clipboard API is unavailable while copying {{target}}.",
        target,
      ),
    });
  }

  try {
    if (extraFlavors && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([value], { type: "text/plain" }),
            ...Object.fromEntries(
              Object.entries(extraFlavors).map(([type, data]) => [
                type,
                new Blob([data], { type }),
              ]),
            ),
          }),
        ]);
        return true;
      } catch {
        // Safari/native bridges may accept HTML but reject Chromium's custom web flavor.
        const html = extraFlavors["text/html"];
        if (html) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": new Blob([value], { type: "text/plain" }),
                "text/html": new Blob([html], { type: "text/html" }),
              }),
            ]);
            return true;
          } catch {}
        }
      }
    }
    await navigator.clipboard.writeText(value);
    return true;
  } catch (cause) {
    throw new ClipboardWriteError({
      target,
      cause,
      messageText: clipboardMessage(
        t,
        "copyFailed",
        "Failed to copy {{target}} to the clipboard.",
        target,
      ),
    });
  }
}

export async function readTextFromClipboard(
  target = "text",
  t: TFunction = englishT,
): Promise<string> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.clipboard?.readText
  ) {
    throw new ClipboardReadUnavailableError({
      target,
      messageText: clipboardMessage(
        t,
        "readUnavailable",
        "Clipboard API is unavailable while reading {{target}}.",
        target,
      ),
    });
  }

  try {
    return await navigator.clipboard.readText();
  } catch (cause) {
    throw new ClipboardReadError({
      target,
      cause,
      messageText: clipboardMessage(
        t,
        "readFailed",
        "Failed to read {{target}} from the clipboard.",
        target,
      ),
    });
  }
}

export function useCopyToClipboard<TContext = void>({
  timeout = 2000,
  target = "text",
  onCopy,
  onError,
  extraFlavors,
}: {
  timeout?: number;
  target?: string;
  onCopy?: (ctx: TContext) => void;
  onError?: (error: Error, ctx: TContext) => void;
  extraFlavors?: Readonly<Record<string, string>>;
} = {}): { copyToClipboard: (value: string, ctx: TContext) => void; isCopied: boolean } {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = React.useState(false);
  const timeoutIdRef = React.useRef<NodeJS.Timeout | null>(null);
  const copyToClipboard = useStableCallback((value: string, ctx: TContext): void => {
    void writeTextToClipboard(value, target, extraFlavors, t).then(
      (didCopy) => {
        if (!didCopy) return;
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
        }
        setIsCopied(true);

        onCopy?.(ctx);

        if (timeout !== 0) {
          timeoutIdRef.current = setTimeout(() => {
            setIsCopied(false);
            timeoutIdRef.current = null;
          }, timeout);
        }
      },
      (error) => {
        console.error(error);
        onError?.(error, ctx);
      },
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the copied-state reset timer on unmount
  React.useEffect(() => {
    return (): void => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  return { copyToClipboard, isCopied };
}
