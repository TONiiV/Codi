import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type Telescope,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import {
  type Dispatch,
  lazy,
  type SetStateAction,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { previewRuntimeTabId } from "../../browser/previewRuntimeTabId";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { ComposerHandleContext } from "../../composerHandleContext";
import { DraftId } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useRightPanelSurfaceClose } from "../../hooks/useRightPanelSurfaceClose";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../keybindings";
import { usePanelAnimationSettings, usePanelPresence } from "../../panelAnimations";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../../previewStateStore";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  fileSurfaceId,
  type RightPanelSurface,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  TELESCOPE_PANEL_SURFACES,
  TELESCOPE_SIDE_CHAT,
  useRightPanelStore,
  withPendingFile,
} from "../../rightPanelStore";
import { useDeviceState } from "../../state/device";
import { useEnvironmentSupportsServerBrowser } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useProjects } from "../../state/entities";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
} from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ChatRightPanel } from "../chat/ChatRightPanel";
import { RightPanelFileSurface } from "../chat/RightPanelSurfaceContent";
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
import { telescope, telescopeBoard, useTelescopeWorkspaces } from "./telescopeState";
import { telescopeFilesTarget } from "./telescopeFiles";
import { TaskDetail } from "./TaskPanel";
import {
  knownProjectId,
  telescopeSearch,
  useTaskParam,
  useTasksLayout,
  useTasksProjectId,
  useTelescopeView,
} from "./telescopeViews";

const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const NO_TERMINALS: ReadonlyMap<string, string> = new Map();
const NO_PENDING: ReadonlySet<string> = new Set();
/** Telescope has no composer to send review comments, so its Files take none; a draft target keeps file assets off any thread. */
const FILES_COMPOSER_TARGET = DraftId.make("telescope-panel");
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

/** A file tab shows the mount it was opened from, whichever project is in context now. */
function FileTab(props: {
  surface: Extract<RightPanelSurface, { kind: "files" | "file" }>;
  panelRef: ScopedThreadRef;
  visible: boolean;
  keybindings: ResolvedKeybindingsConfig;
  remote: ReadonlyArray<string>;
  pendingSurfaceIds: ReadonlySet<string>;
  setPendingSurfaceIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
}) {
  const { surface, panelRef } = props;
  const { projectId } = surface;
  const project = useProjects().find(
    (entry) => entry.environmentId === panelRef.environmentId && entry.id === projectId,
  );
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  if (project === undefined && (surface.kind === "files" || surface.attachment === undefined)) {
    return (
      <p className="m-auto p-4 text-center text-muted-foreground text-sm">
        这个标签页的目录在这台机器上找不到了。
      </p>
    );
  }
  const body = (
    <RightPanelFileSurface
      surface={surface}
      threadRef={panelRef}
      environmentId={panelRef.environmentId}
      visible={props.visible}
      composerDraftTarget={FILES_COMPOSER_TARGET}
      reviewComments={false}
      keybindings={props.keybindings}
      workspaceMutationId={null}
      files={{
        projectId,
        projectName: project?.title ?? null,
        workspaceRoot: project?.workspaceRoot,
        availableEditors,
        pendingSurfaceIds: props.pendingSurfaceIds,
        onOpenFile: (relativePath) =>
          useRightPanelStore.getState().openFile(panelRef, relativePath, undefined, projectId),
        onPendingChange: (relativePath, pending) =>
          props.setPendingSurfaceIds((current) =>
            withPendingFile(current, fileSurfaceId(relativePath, projectId), pending),
          ),
      }}
    />
  );
  if (props.remote.length === 0) return body;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 truncate border-b border-border px-3 py-1 text-muted-foreground text-xs">
        {`另一台机器上（这里打不开）：${props.remote.join("、")}`}
      </p>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
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
  const taskParam = useTaskParam();
  const view = useTelescopeView();
  const layout = useTasksLayout();
  const project = useTasksProjectId();
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
  // The project Files follows: the active task tab's, else the last task looked at while the
  // sidebar selection is unchanged and its tab is open, else the sidebar's selected project.
  const projectsQuery = useEnvironmentQuery(
    workspaceId === null ? null : telescope.projects({ environmentId, input: { workspaceId } }),
  );
  const selectedProject = knownProjectId(project, projectsQuery.data?.projects ?? null);
  const [lastTask, setLastTask] = useState<{
    taskId: Telescope.TaskId;
    project: Telescope.TelescopeProjectId | undefined;
  } | null>(null);
  if (
    activeTaskId !== null &&
    (lastTask?.taskId !== activeTaskId || lastTask.project !== selectedProject)
  ) {
    setLastTask({ taskId: activeTaskId, project: selectedProject });
  }
  const contextTaskId =
    activeTaskId ??
    (lastTask !== null &&
    lastTask.project === selectedProject &&
    state.surfaces.some((surface) => surface.kind === "task" && surface.taskId === lastTask.taskId)
      ? lastTask.taskId
      : null);
  const contextTask = useEnvironmentQuery(
    workspaceId === null || contextTaskId === null
      ? null
      : telescopeBoard.task({ environmentId, input: { workspaceId, taskId: contextTaskId } }),
  ).data;
  const codiProjects = useProjects();
  const filesProjectId = contextTask?.projectId ?? selectedProject;
  const filesTarget = telescopeFilesTarget(
    projectsQuery.data?.projects.find((entry) => entry.id === filesProjectId),
    environmentId,
    codiProjects,
  );
  const [pendingFiles, setPendingFiles] = useState<ReadonlySet<string>>(NO_PENDING);
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
      void navigate({
        to: TELESCOPE_PATH,
        search: telescopeSearch(view, layout, { project }),
        replace: true,
      });
    }
  }, [taskParam, activeTaskId, view, layout, project, navigate]);
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
          defaultWidthFraction={TELESCOPE_PANEL_WIDTH_FRACTION}
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
          pendingSurfaceIds={pendingFiles}
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
          onAddFiles={() => {
            if (filesTarget.ready) {
              useRightPanelStore
                .getState()
                .openFile(panelRef, ".", undefined, filesTarget.projectId);
            }
          }}
          onAddPullRequest={noop}
          onAddPullRequests={noop}
          onAddDevice={noop}
          onAddSideChat={() =>
            useRightPanelStore.getState().openSideChat(panelRef, TELESCOPE_SIDE_CHAT)
          }
          browserAvailable={canOperatePreview && browserAvailable}
          terminalAvailable={false}
          diffAvailable={false}
          filesAvailable={filesTarget.ready}
          filesDisabledReason={filesTarget.ready ? null : filesTarget.reason}
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
          ) : active?.kind === "files" || active?.kind === "file" ? (
            <FileTab
              surface={active}
              panelRef={panelRef}
              visible={open}
              keybindings={keybindings}
              remote={
                active.kind === "files" &&
                filesTarget.ready &&
                filesTarget.projectId === active.projectId
                  ? filesTarget.remote
                  : []
              }
              pendingSurfaceIds={pendingFiles}
              setPendingSurfaceIds={setPendingFiles}
            />
          ) : active?.kind === "task" ? (
            <TaskDetail
              key={active.id}
              target={{ environmentId, workspaceId: active.workspaceId }}
              taskId={active.taskId}
            />
          ) : null}
        </ChatRightPanel>
      ) : null}
    </>
  );
}
