import { useNavigate, type AnyRouter } from "@tanstack/react-router";

import { GUEST_PAGE_PATH } from "../../guestPage";
import { withoutAssistantCitationHash } from "../../lib/assistantCitationNavigation";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

export function isSidebarUtilityPage(pathname: string) {
  return pathname.startsWith("/projects/") || pathname === "/pull-requests";
}

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

export const TELESCOPE_PATH = "/telescope";

let mainAppHref: string | null = null;
let appModalReturnHref: string | null = null;
let codeHref: string | null = null;
let telescopeHref: string | null = null;

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    const href = withoutAssistantCitationHash(router.state.location.href);
    appModalReturnHref = href;
    if (isSidebarUtilityPage(pathname)) return;
    mainAppHref = href;
    if (pathname === TELESCOPE_PATH) telescopeHref = href;
    else codeHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Switches between Code and Telescope, back to where each was last left. */
export function useNavigateToAppMode() {
  const navigate = useNavigate();
  return (mode: "code" | "telescope") =>
    navigate({ href: mode === "code" ? (codeHref ?? "/") : (telescopeHref ?? TELESCOPE_PATH) });
}

/** The page Settings or Usage would return to, read during render. */
export function peekAppModalReturnHref() {
  return appModalReturnHref;
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? mainAppHref ?? "/" });
}
