import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import {
  selectThreadRightPanelState,
  telescopePanelRef,
  useRightPanelStore,
} from "../../rightPanelStore";
import { TELESCOPE_PATH, useNavigateToAppMode } from "../sidebar/mainAppLocation";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarContent, SidebarGroup, SidebarInset, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { MicroscopeGlyph } from "./ModeGlyphs";
import { MyTeamsPage } from "./MyTeamsPage";
import { TasksSidebar } from "./TasksSidebar";
import { TelescopeAccountFooter } from "./TelescopeAccount";
import { TelescopeChatList } from "./TelescopeChatList";
import { TelescopeChatPage } from "./TelescopeChatPage";
import { TelescopeDashboard } from "./TelescopeDashboard";
import { FirstRunGate } from "./TelescopeFirstRun";
import { TelescopePanel } from "./TelescopePanel";
import { useTelescopeWorkspaces } from "./telescopeState";
import {
  VISIBLE_TELESCOPE_VIEWS,
  telescopeViewEntry,
  type TelescopeView,
  useTasksLayout,
} from "./telescopeViews";

function TelescopeRail({ view, collapsed }: { view: TelescopeView; collapsed: boolean }) {
  const navigate = useNavigate();
  const navigateToAppMode = useNavigateToAppMode();
  const { isMobile, setOpenMobile } = useSidebar();
  const layout = useTasksLayout();
  return (
    <nav
      aria-label="Telescope"
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-1 py-2",
        collapsed ? "flex-1 border-t" : "border-e",
      )}
    >
      {VISIBLE_TELESCOPE_VIEWS.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <Button
                aria-label={item.label}
                aria-current={item.id === view ? "page" : undefined}
                size="icon"
                variant={item.id === view ? "secondary" : "ghost-muted"}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                  void navigate({
                    to: TELESCOPE_PATH,
                    search: { view: item.id, ...(layout === "table" ? {} : { layout }) },
                  });
                }}
              />
            }
          >
            <item.icon />
          </TooltipTrigger>
          <TooltipPopup side="right">{item.label}</TooltipPopup>
        </Tooltip>
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="回到 Code"
              className="mt-auto"
              data-glyph-trigger=""
              size="icon"
              variant="ghost-muted"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigateToAppMode("code");
              }}
            />
          }
        >
          <MicroscopeGlyph />
        </TooltipTrigger>
        <TooltipPopup side="right">回到 Code</TooltipPopup>
      </Tooltip>
    </nav>
  );
}

/** Telescope's side of the app sidebar: the view rail beside a body slot for the view's list. */
export function TelescopeSidebar({
  view,
  children,
}: {
  view: TelescopeView;
  children?: ReactNode;
}) {
  const { state, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-(--workspace-topbar-height) shrink-0" />
        <TelescopeRail view={view} collapsed />
      </div>
    );
  }
  return (
    <>
      {/* The stage artwork runs past the header; stop it at the border under the header. Clip
          only that edge: under a top inset the phone sheet's toggle sits above the header. */}
      <div className="shrink-0 [clip-path:inset(-100vmax_-100vmax_0)]">
        <SidebarChromeHeader isElectron={isElectron} />
      </div>
      {/* The mobile sheet sizes to its content, and most views' bodies are still empty. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 border-t",
          isMobile && "w-[calc(100vw-(--spacing(12)))]",
        )}
      >
        <TelescopeRail view={view} collapsed={false} />
        <SidebarContent className="min-h-full">
          <SidebarGroup>
            {children ??
              (view === "chats" ? (
                <TelescopeChatList />
              ) : view === "tasks" ? (
                <TasksSidebar />
              ) : null)}
          </SidebarGroup>
        </SidebarContent>
      </div>
      <TelescopeAccountFooter />
      <SidebarChromeFooter />
    </>
  );
}

export function TelescopeEmptyState({
  view,
  title,
  description,
}: {
  view: TelescopeView;
  title?: string;
  description?: string;
}) {
  const entry = telescopeViewEntry(view);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <entry.icon />
        </EmptyMedia>
        <EmptyTitle>{title ?? entry.emptyTitle}</EmptyTitle>
        <EmptyDescription>{description ?? entry.emptyDescription}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// Clears the floating sidebar toggle, which sits over the icon rail when the sidebar is collapsed.
const TITLEBAR_INSET = {
  "--telescope-collapsed-left":
    "max(var(--workspace-gutter-start), calc(var(--workspace-titlebar-content-left) - var(--sidebar-width-icon)))",
} as CSSProperties;

/**
 * Telescope's main area: breadcrumb header and a main slot that falls back to the view's empty
 * state. `background` keeps it inert under Settings or Usage.
 */
export function TelescopePage({
  view,
  background = false,
  children,
}: {
  view: TelescopeView;
  background?: boolean;
  children?: ReactNode;
}) {
  const { environmentId } = useTelescopeWorkspaces();
  const panelRef = background || environmentId === null ? null : telescopePanelRef(environmentId);
  const panel = useRightPanelStore((store) =>
    selectThreadRightPanelState(store.byThreadKey, panelRef),
  );
  const maximized = panel.isOpen && panel.maximized === true;
  const [layoutElement, setLayoutElement] = useState<HTMLDivElement | null>(null);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none" inert={background}>
      <div ref={setLayoutElement} className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn("flex min-h-0 min-w-0 flex-col", maximized ? "w-0 flex-none" : "flex-1")}
          inert={maximized}
        >
          <WorkspacePageHeader
            electron={isElectron}
            reserveNativeControls={isElectron && !panel.isOpen}
            className="md:[[data-sidebar-state=collapsed]_&]:pl-(--telescope-collapsed-left)"
            style={TITLEBAR_INSET}
          >
            <WorkspaceBreadcrumb ariaLabel="Telescope breadcrumb">
              <WorkspaceBreadcrumbItem>
                <span>Telescope</span>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current>
                <h1>{telescopeViewEntry(view).label}</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          </WorkspacePageHeader>
          {/* The top border, not the header's bottom one, lines up with the sidebar's under its header. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t">
            <BackgroundThreadContext value={background}>
              <FirstRunGate>
                {children ??
                  (view === "chats" ? (
                    <TelescopeChatPage />
                  ) : view === "teams" ? (
                    <MyTeamsPage />
                  ) : view === "dashboard" ? (
                    <TelescopeDashboard />
                  ) : (
                    <TelescopeEmptyState view={view} />
                  ))}
              </FirstRunGate>
            </BackgroundThreadContext>
          </div>
        </div>
        {panelRef === null ? null : (
          <TelescopePanel panelRef={panelRef} layoutElement={layoutElement} />
        )}
      </div>
    </SidebarInset>
  );
}
