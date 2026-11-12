import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  Telescope,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useEffectEvent, useRef } from "react";

import { previewRuntimeTabId } from "../../browser/previewRuntimeTabId";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { ComposerHandleContext } from "../../composerHandleContext";
import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useRightPanelSurfaceClose } from "../../hooks/useRightPanelSurfaceClose";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../keybindings";
import { usePanelAnimationSettings, usePanelPresence } from "../../panelAnimations";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../../previewStateStore";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  TELESCOPE_PANEL_SURFACES,
  TELESCOPE_SIDE_CHAT,
  useRightPanelStore,
} from "../../rightPanelStore";
import { useDeviceState } from "../../state/device";
import { useEnvironmentSupportsServerBrowser } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ChatRightPanel } from "../chat/ChatRightPanel";
import { usePreviewSession } from "../preview/usePreviewSession";
import {
  PanelLayoutControls,
  RightPanelMaximizeControl,
  WorkspaceTitlebarControls,
} from "../chat/PanelLayoutControls";
import { useRightPanelActions } from "../chat/useRightPanelActions";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { agentDisplayName, telescopeAgents } from "./myTeamsShared";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { AgentChat } from "./TelescopeChatPage";
import { useTelescopeWorkspaces } from "./telescopeState";
import { TaskDetail } from "./TaskPanel";
import {
  telescopeSearch,
  useTaskDrawerId,
  useTasksLayout,
  useTelescopeView,
} from "./telescopeViews";

const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const NO_TERMINALS: ReadonlyMap<string, string> = new Map();
const NO_PENDING: ReadonlySet<string> = new Set();
/** Telescope's panel opens this much of the row, so a task reads as a page beside the board. */
const TELESCOPE_PANEL_WIDTH_FRACTION = 0.6;
const PANEL_COMMANDS = ["rightPanel.toggle", "rightPanel.toggleMaximized", "rightPanel.close"];
const noop = () => undefined;
const shortcutContext = () => ({
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: !isElectron,
  isDesktop: isElectron,
});

function SideChat(props: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  onClose: () => void;
}) {
  const { environmentId, workspace } = props;
  const mine = useEnvironmentQuery(
    telescopeAgents.listMine({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const assistant = mine.data?.agents.find((agent) => agent.kind === "chief_of_staff") ?? null;
  return (
    <div data-side-chat-pane className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-sm">
          {assistant === null ? null : agentDisplayName(assistant)}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Close side chat" onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
      {assistant !== null ? (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <AgentChat
              key={assistant.id}
              environmentId={environmentId}
              workspace={workspace}
              agent={assistant}
              sideChat
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      ) : mine.data !== null ? (
        <p className="m-auto text-muted-foreground text-sm">这个工作区里还没有你的个人助理。</p>
      ) : mine.error !== null ? (
        <ErrorNote text="读取失败" onRetry={mine.refresh} />
      ) : (
        <Spinner className="m-auto" tone="muted" />
      )}
    </div>
  );
}

/** Code's right panel on Telescope pages; closed, it mounts only the window's panel controls. */
export function TelescopePanel(props: {
  readonly panelRef: ScopedThreadRef;
  readonly layoutElement: HTMLElement | null;
}) {
  const { panelRef } = props;
  const { environmentId } = panelRef;
  const workspace = useTelescopeWorkspaces().current;
  const taskParam = useTaskDrawerId();
  const view = useTelescopeView();
  const layout = useTasksLayout();
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const state = useRightPanelStore((store) =>
    selectThreadRightPanelState(store.byThreadKey, panelRef),
  );
  const activeSurface = useRightPanelStore((store) =>
    selectActiveRightPanelSurface(store.byThreadKey, panelRef),
  );
  const open = state.isOpen;
  const maximized = open && state.maximized === true;
  const sheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY) && !maximized;
  const { active: animated, durationMs } = usePanelAnimationSettings();
  const presence = usePanelPresence(
    open,
    { activeSurface, surfaces: state.surfaces },
    animated,
    scopedThreadKey(panelRef),
    durationMs,
  );
  const previewState = useThreadPreviewState(panelRef);
  const activeTaskId = activeSurface?.kind === "task" ? activeSurface.taskId : null;
  const workspaceId = workspace?.id ?? null;
  const seenTaskRef = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the `task` search param is a deep link into the panel's tab store
  useEffect(() => {
    if (taskParam !== null && workspaceId !== null) {
      useRightPanelStore.getState().openTask(panelRef, { workspaceId, taskId: taskParam });
    }
  }, [panelRef, taskParam, workspaceId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the param names the tab on screen, so it clears once another tab or none is
  useEffect(() => {
    if (taskParam === null) {
      seenTaskRef.current = null;
      return;
    }
    if (activeTaskId === taskParam) seenTaskRef.current = taskParam;
    else if (seenTaskRef.current === taskParam && view !== null) {
      void navigate({ to: TELESCOPE_PATH, search: telescopeSearch(view, layout), replace: true });
    }
  }, [taskParam, activeTaskId, view, layout, navigate]);
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const serverBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  const browserAvailable = serverBrowser || isPreviewSupportedInRuntime();
  usePreviewSession(open && canOperatePreview && serverBrowser ? panelRef : null);
  const explicitDiffOpenRef = useRef<ScopedThreadRef | null>(null);
  const closers = useRightPanelSurfaceClose({
    threadRef: panelRef,
    terminalLabelsById: NO_TERMINALS,
  });
  const actions = useRightPanelActions({
    activeThreadRef: panelRef,
    activeProject: null,
    activeRightPanelSurface: activeSurface,
    activePreviewState: previewState,
    deviceState: useDeviceState(null).state,
    deviceStateLoaded: false,
    pullRequestPanelTarget: null,
    threadPanelPresentation: "inline",
    isServerThread: false,
    embedded: false,
    isGitRepo: false,
    browserAvailable,
    canOperatePreview,
    diffOpen: false,
    previewPanelOpen: open && activeSurface?.kind === "preview",
    rightPanelOpen: open,
    canMaximizeRightPanel: open,
    rightPanelMaximized: maximized,
    supportsPullRequests: false,
    pullRequestsSurfaceAvailable: false,
    gitCwd: null,
    activeProjectCwd: null,
    explicitDiffOpenRef,
    onDiffPanelOpen: undefined,
    closeRightPanelSurface: closers.closeSurface,
  });

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isCommandPaletteOpen()) return;
    const command = resolveShortcutCommand(event, keybindings, { context: shortcutContext() });
    if (command === null || !PANEL_COMMANDS.includes(command)) return;
    const run = actions.shortcuts[command as keyof typeof actions.shortcuts];
    if (run({ event, terminalFocusOwner: null }) === false) return;
    event.preventDefault();
    event.stopPropagation();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener for the panel's toggle, maximize and close shortcuts
  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const { toggleRightPanelStable, toggleRightPanelMaximizedStable } = actions;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to desktop bridge menu actions forwarded while a browser page has focus
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action === "rightPanel.toggle") toggleRightPanelStable();
        else if (action === "rightPanel.toggleMaximized") toggleRightPanelMaximizedStable();
      }),
    [toggleRightPanelStable, toggleRightPanelMaximizedStable],
  );

  const active = presence.value?.activeSurface ?? null;
  const toggles = (
    <PanelLayoutControls
      showThreadPanelControl={false}
      showTerminalControl={false}
      terminalAvailable={false}
      terminalOpen={false}
      terminalShortcutLabel={null}
      threadPanelOpen={false}
      threadPanelPresentation="inline"
      threadPanelShortcutLabel={null}
      rightPanelAvailable
      rightPanelOpen={open}
      rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
      onToggleTerminal={noop}
      onToggleThreadPanel={noop}
      onToggleRightPanel={actions.toggleRightPanelStable}
    />
  );

  return (
    <>
      {sheet && presence.present && open ? null : (
        <WorkspaceTitlebarControls
          showMaximizeControl={!sheet}
          rightPanelOpen={open}
          animationsActive={animated}
          maximized={maximized}
          onToggleMaximized={actions.toggleRightPanelMaximizedStable}
        >
          {toggles}
        </WorkspaceTitlebarControls>
      )}
      {presence.present ? (
        <ChatRightPanel
          sheet={sheet}
          workspaceLayoutElement={props.layoutElement}
          widthStorageKey={`t3code:preview-panel-width:${scopedThreadKey(panelRef)}`}
          {...(props.layoutElement === null
            ? {}
            : {
                defaultWidth: Math.round(
                  props.layoutElement.clientWidth * TELESCOPE_PANEL_WIDTH_FRACTION,
                ),
              })}
          sheetAnimationDurationMs={animated ? durationMs : 0}
          onCloseSheet={actions.closePreviewPanelStable}
          open={open}
          keybindings={keybindings}
          getShortcutContext={shortcutContext}
          maximized={maximized}
          layoutControls={
            open ? (
              <div className="mr-px flex items-center gap-1">
                <RightPanelMaximizeControl
                  maximized={maximized}
                  onToggle={actions.toggleRightPanelMaximizedStable}
                />
                {toggles}
              </div>
            ) : null
          }
          surfaces={presence.value?.surfaces ?? []}
          environmentId={environmentId}
          activeSurfaceId={active?.id ?? null}
          pendingSurfaceIds={NO_PENDING}
          previewSessions={previewState.sessions}
          desktopByTabId={previewState.desktopByTabId}
          previewRuntimeTabId={(tabId) =>
            previewRuntimeTabId(panelRef, previewState.serverEpoch, tabId)
          }
          terminalLabelsById={NO_TERMINALS}
          onActivate={actions.activateRightPanelSurfaceStable}
          onCloseSurface={closers.closeSurface}
          onCloseOtherSurfaces={closers.closeOtherSurfaces}
          onCloseSurfacesToRight={closers.closeSurfacesToRight}
          onCloseAllSurfaces={closers.closeAllSurfaces}
          onMoveSurface={actions.moveRightPanelSurfaceStable}
          onCopyFilePath={noop}
          onAddBrowser={() => actions.createBrowserSurface()}
          onAddBrowserInProfile={actions.createBrowserSurfaceStable}
          onAddTerminal={noop}
          onAddDiff={noop}
          onAddFiles={noop}
          onAddPullRequest={noop}
          onAddPullRequests={noop}
          onAddDevice={noop}
          onAddSideChat={() =>
            useRightPanelStore.getState().openSideChat(panelRef, TELESCOPE_SIDE_CHAT)
          }
          browserAvailable={canOperatePreview && browserAvailable}
          terminalAvailable={false}
          diffAvailable={false}
          filesAvailable={false}
          pullRequestAvailable={false}
          pullRequestsAvailable={false}
          deviceAvailable={false}
          sideChatAvailable
          sideChatDisabledReason={workspace === null ? "建好或加入一个工作区后可用。" : null}
          surfaceKinds={TELESCOPE_PANEL_SURFACES}
        >
          {active?.kind === "preview" ? (
            <Suspense fallback={null}>
              <PreviewPanel
                mode="embedded"
                threadRef={panelRef}
                tabId={active.resourceId}
                visible={open}
              />
            </Suspense>
          ) : active?.kind === "side-chat" && workspace !== null ? (
            <SideChat
              environmentId={environmentId}
              workspace={workspace}
              onClose={() => closers.closeSurface(active)}
            />
          ) : active?.kind === "task" ? (
            <div className="flex h-full min-h-0 flex-col">
              <TaskDetail
                key={active.id}
                target={{
                  environmentId,
                  workspaceId: Telescope.WorkspaceId.make(active.workspaceId),
                }}
                taskId={Telescope.TaskId.make(active.taskId)}
              />
            </div>
          ) : null}
        </ChatRightPanel>
      ) : null}
    </>
  );
}
