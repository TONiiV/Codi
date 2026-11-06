import { useNavigate } from "@tanstack/react-router";
import { MicroscopeIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
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
import { MyTeamsPage } from "./MyTeamsPage";
import { TelescopeAccountFooter } from "./TelescopeAccount";
import { TelescopeDashboard } from "./TelescopeDashboard";
import {
  TELESCOPE_VIEWS,
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
        collapsed ? "flex-1" : "border-e",
      )}
    >
      {TELESCOPE_VIEWS.map((item) => (
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
                    search: { view: item.id, ...(layout === "board" ? { layout } : {}) },
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
              size="icon"
              variant="ghost-muted"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigateToAppMode("code");
              }}
            />
          }
        >
          <MicroscopeIcon />
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
      <SidebarChromeHeader isElectron={isElectron} />
      {/* The mobile sheet sizes to its content, and this body has none yet. */}
      <div className={cn("flex min-h-0 flex-1", isMobile && "w-[calc(100vw-(--spacing(12)))]")}>
        <TelescopeRail view={view} collapsed={false} />
        <SidebarContent className="min-h-full">
          <SidebarGroup>
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {telescopeViewEntry(view).label}
            </div>
            {children}
          </SidebarGroup>
        </SidebarContent>
      </div>
      <TelescopeAccountFooter />
      <SidebarChromeFooter />
    </>
  );
}

export function TelescopeEmptyState({ view }: { view: TelescopeView }) {
  const entry = telescopeViewEntry(view);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <entry.icon />
        </EmptyMedia>
        <EmptyTitle>{entry.emptyTitle}</EmptyTitle>
        <EmptyDescription>{entry.emptyDescription}</EmptyDescription>
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
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none" inert={background}>
      <WorkspacePageHeader
        electron={isElectron}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children ??
          (view === "teams" ? (
            <MyTeamsPage />
          ) : view === "dashboard" ? (
            <TelescopeDashboard />
          ) : (
            <TelescopeEmptyState view={view} />
          ))}
      </div>
    </SidebarInset>
  );
}
