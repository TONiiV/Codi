import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { sideChatAgents } from "@t3tools/client-runtime/telescope/agents";
import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { lazy, Suspense, useEffect, useEffectEvent, useRef } from "react";

import { previewRuntimeTabId } from "../../browser/previewRuntimeTabId";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { ComposerHandleContext } from "../../composerHandleContext";
import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
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
  useRightPanelStore,
} from "../../rightPanelStore";
import { useDeviceState } from "../../state/device";
import { useEnvironmentSupportsServerBrowser } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ChatRightPanel } from "../chat/ChatRightPanel";
import {
  PanelLayoutControls,
  RightPanelMaximizeControl,
  WorkspaceTitlebarControls,
} from "../chat/PanelLayoutControls";
import { useRightPanelActions } from "../chat/useRightPanelActions";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { agentDisplayName, telescopeAgents } from "./myTeamsShared";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { AgentChat } from "./TelescopeChatPage";
import { useTelescopeWorkspaces } from "./telescopeState";
import { type TelescopeView, useChatAgentId, useTaskDrawerId } from "./telescopeViews";

const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
// One side chat tab; its header picks the agent, so it names no real thread.
const AGENT_CHAT = ThreadId.make("telescope-agent-chat");
const AGENT_KEY = "t3code:telescope:side-chat-agent:v1";
const StoredAgent = Schema.NullOr(Telescope.AgentId);
const NO_TERMINALS: ReadonlyMap<string, string> = new Map();
const NO_PENDING: ReadonlySet<string> = new Set();
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
  mainAgentId: Telescope.AgentId | null;
  onClose: () => void;
}) {
  const { environmentId, workspace } = props;
  const input = { workspaceId: workspace.id };
  const mine = useEnvironmentQuery(telescopeAgents.listMine({ environmentId, input }));
  const company = useEnvironmentQuery(
    workspace.kind === "enterprise" ? telescopeAgents.listCompany({ environmentId, input }) : null,
  );
  const [stored, setStored] = useLocalStorage(AGENT_KEY, null, StoredAgent);
  const agents = [...(mine.data?.agents ?? []), ...(company.data?.agents ?? [])];
  const { choices, shown } = sideChatAgents(agents, stored, props.mainAgentId);
  return (
    <div data-side-chat-pane className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-1.5">
        <div className="min-w-0 flex-1">
          {shown === null ? null : (
            <Select value={shown.id} onValueChange={setStored}>
              <SelectTrigger size="sm" variant="ghost" aria-label="Side chat 的 agent">
                <SelectValue>{agentDisplayName(shown)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {choices.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agentDisplayName(agent)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close side chat" onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
      {shown !== null ? (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <AgentChat
              key={shown.id}
              environmentId={environmentId}
              workspace={workspace}
              agent={shown}
              sideChat
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      ) : mine.data !== null ? (
        <p className="m-auto text-muted-foreground text-sm">还没有 agent。</p>
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
  readonly view: TelescopeView;
  readonly layoutElement: HTMLElement | null;
}) {
  const { panelRef } = props;
  const { environmentId } = panelRef;
  const workspace = useTelescopeWorkspaces().current;
  const chatAgentId = useChatAgentId();
  // The task drawer covers the window's top right, where the panel controls sit.
  const covered = useTaskDrawerId() !== null;
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
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const browserAvailable =
    useEnvironmentSupportsServerBrowser(environmentId) || isPreviewSupportedInRuntime();
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

  // Panel actions of hosted chats can add surfaces Telescope does not offer; those stay hidden.
  const surfaces = (presence.value?.surfaces ?? []).filter((surface) =>
    TELESCOPE_PANEL_SURFACES.includes(surface.kind),
  );
  const active = surfaces.find((surface) => surface === presence.value?.activeSurface) ?? null;
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
      {covered || (sheet && presence.present && open) ? null : (
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
          surfaces={surfaces}
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
          onAddSideChat={() => useRightPanelStore.getState().openSideChat(panelRef, AGENT_CHAT)}
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
              mainAgentId={props.view === "chats" ? chatAgentId : null}
              onClose={() => closers.closeSurface(active)}
            />
          ) : null}
        </ChatRightPanel>
      ) : null}
    </>
  );
}
