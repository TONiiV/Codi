// PROTOTYPE, wipe me. Where Lighthouse is "on": its own route, or its route sitting behind the
// Settings / Usage modal that was opened from it.
import { useLocation } from "@tanstack/react-router";

import { isAppModalPage, peekAppModalReturnHref } from "../sidebar/mainAppLocation";
import type { LighthouseChatId, LighthouseView, LighthouseViewer } from "./lighthouseData";

export type LighthouseVariant = "A" | "B" | "C";
export interface LighthouseSearch {
  readonly variant: LighthouseVariant;
  readonly as: LighthouseViewer;
  readonly chat: LighthouseChatId;
  readonly view: LighthouseView;
}

const LIGHTHOUSE_PATH = "/prototype/lighthouse";

export function normalizeLighthouseSearch(raw: Record<string, unknown>): LighthouseSearch {
  return {
    variant: raw.variant === "B" || raw.variant === "C" ? raw.variant : "A",
    as: raw.as === "lead" || raw.as === "member" ? raw.as : "admin",
    chat:
      raw.chat === "codi" || raw.chat === "site" || raw.chat === "app" || raw.chat === "desk"
        ? raw.chat
        : "mine",
    view:
      raw.view === "bots" || raw.view === "dashboard" || raw.view === "tasks" ? raw.view : "chats",
  };
}

function lighthouseHref(pathname: string, href: string): string | null {
  if (pathname.startsWith(LIGHTHOUSE_PATH)) return href;
  if (!isAppModalPage(pathname)) return null;
  const opener = peekAppModalReturnHref();
  return opener?.startsWith(LIGHTHOUSE_PATH) ? opener : null;
}

/** The Lighthouse search in effect, or null when Lighthouse is not showing. */
export function useLighthouseSearch(): LighthouseSearch | null {
  const href = useLocation({ select: (l) => lighthouseHref(l.pathname, l.href) });
  if (href === null) return null;
  const params = new URL(href, "http://lighthouse.local").searchParams;
  return normalizeLighthouseSearch(Object.fromEntries(params));
}
