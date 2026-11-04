import { useAtomValue } from "@effect/atom-react";
import { NotificationSettings } from "./NotificationSettings";
import { PRIVACY_POLICY_URL } from "../../legalLinks";
import { CheckIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DesktopUpdateChannel,
  IDLE_COMPACTION_MODES,
  globalIdleCompaction,
  managedUpdatesDenial,
  managedUpdatesMessage,
  ProviderDriverKind,
  type ProviderInstanceId,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  AppLanguage,
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ResponseStreamingMode,
  QuitConfirmationMode,
  SidebarProjectSortOrder,
} from "@t3tools/contracts/settings";
import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import { createModelSelection } from "@t3tools/shared/model";
import { resolvePastedPath } from "@t3tools/shared/path";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import { AboutVersionTitle } from "./AboutVersionTitle";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import { MobileAppSettingsRow } from "./MobileAppSettingsRow";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { scopedIdleCompaction } from "./scopedSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { managedTelemetryOffMessage, usePrimaryManagedPolicy } from "../../state/managedPolicy";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { PullRequestLinksOpenInAppSetting } from "./IntegrationsSettings";
import { StorageCleanupSections } from "./StorageSettings";
import { UpdateTrackSwitchDialog } from "./UpdateTrackSwitchDialog";
import { environmentIdsKey } from "~/state/environmentAtomList";
import { environmentSessionStatesAtom } from "~/state/session";
import { canUpdateServer } from "../ServerUpdateAction";
import { useUpdateEverythingRun } from "../sidebar/updateEverythingRun";
import { awaitsTrackSwitch, channelSwitchLabel } from "../sidebar/updateEverything.logic";
import { isHostedByThisApp } from "../sidebar/useUpdateEverything";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "Text appears once the agent finishes its turn.",
  paragraph: "Each paragraph or code block appears as soon as it is complete.",
};

const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);
const isAppLanguage = Schema.is(AppLanguage);

const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: "Stacked",
  split: "Split",
};

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
function AboutVersionSection() {
  const { t } = useTranslation();
  const updateState = useDesktopUpdateState();
  const [switchChannel, setSwitchChannel] = useState<DesktopUpdateChannel | null>(null);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);
  const { environments } = useEnvironments();
  const sessionStates = useAtomValue(
    environmentSessionStatesAtom(
      environmentIdsKey(environments.map(({ environmentId }) => environmentId)),
    ),
  );
  // A second run would replace the first run's progress and local download.
  const updateRun = useUpdateEverythingRun();

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  // The desktop updates this machine, whose policy the primary environment reports.
  const primaryPolicy = usePrimaryManagedPolicy();
  const updatesDenial = hasDesktopBridge ? managedUpdatesDenial(primaryPolicy) : undefined;
  const nightlyDeniedBy =
    hasDesktopBridge && primaryPolicy?.limits?.updates?.allowNightly === false
      ? primaryPolicy.organization
      : undefined;
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;
  // A switch that failed part way leaves this app or a server on the other track.
  // With its updater off, a switch cannot move this app, so it is not counted.
  const appOffTrack =
    updateState?.enabled !== false && desktopUpdateChannelOf(APP_VERSION) !== selectedUpdateChannel;
  const unswitchedMachines =
    (appOffTrack ? 1 : 0) +
    environments.filter(
      (environment, index) =>
        environment.connection.phase === "connected" &&
        canUpdateServer(sessionStates[index]!) &&
        awaitsTrackSwitch(
          {
            serverConfig: environment.serverConfig,
            hostedByThisApp: isHostedByThisApp(environment),
          },
          selectedUpdateChannel,
        ),
    ).length;

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge.downloadUpdate().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.text.couldNotDownloadUpdate"),
            description: error instanceof Error ? error.message : t("settings.text.downloadFailed"),
          }),
        );
      });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
          ),
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.text.couldNotConfirmUpdate"),
            description:
              error instanceof Error ? error.message : t("settings.text.updateConfirmationFailed"),
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: t("settings.text.couldNotInstallUpdate"),
              description:
                error instanceof Error ? error.message : t("settings.text.installFailed"),
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: t("settings.text.couldNotCheckForUpdates"),
              description:
                updatesDenial ??
                result.state.message ??
                t("settings.text.automaticUpdatesAreNotAvailableIn"),
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.text.couldNotCheckForUpdates"),
            description:
              error instanceof Error ? error.message : t("settings.text.updateCheckFailed"),
          }),
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    // Off its track, "up to date" only means no switch is pending; Review moves it.
    ...(appOffTrack ? {} : { "up-to-date": "Up to Date" }),
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : (getDesktopUpdateDisabledReason(updateState, updatesDenial) ??
        "Current version of the application.");

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={<AboutVersionTitle />}
        description={description}
        managed={updatesDenial}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={
            nightlyDeniedBy !== undefined ? (
              `${managedUpdatesMessage(nightlyDeniedBy)} Nightly builds are not available${
                selectedUpdateChannel === "nightly"
                  ? "; switch to Stable to keep getting updates."
                  : "."
              }`
            ) : unswitchedMachines > 0 ? (
              <>
                {unswitchedMachines === 1
                  ? t("settings.text.n1MachineStillRuns")
                  : t("settings.text.unswitchedmachinesMachinesStillRun", {
                      unswitchedMachines,
                    })}{" "}
                {channelSwitchLabel(selectedUpdateChannel === "nightly" ? "latest" : "nightly")}.{" "}
                {/* The dialog moves what it can and says why it skips the rest. */}
                <Button
                  size="xs"
                  variant="link"
                  disabled={updateRun !== null}
                  onClick={() => setSwitchChannel(selectedUpdateChannel)}
                >
                  {t("settings.text.review")}
                </Button>
              </>
            ) : (
              t("settings.text.switchesThisAppAndEveryConnected")
            )
          }
          managed={updatesDenial}
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                if (value !== selectedUpdateChannel) {
                  setSwitchChannel(value as DesktopUpdateChannel);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.text.updateTrack")}
                disabled={switchChannel !== null || updateRun !== null}
              >
                <SelectValue>{channelSwitchLabel(selectedUpdateChannel)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("settings.text.stable")}
                </SelectItem>
                <SelectItem
                  hideIndicator
                  value="nightly"
                  disabled={nightlyDeniedBy !== undefined && selectedUpdateChannel !== "nightly"}
                >
                  {t("settings.text.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={t("settings.text.switchesTheHostedAppReleaseChannel")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.text.updateTrack")}
              >
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("settings.text.latest")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("settings.text.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
      {switchChannel === null ? null : (
        <UpdateTrackSwitchDialog channel={switchChannel} onClose={() => setSwitchChannel(null)} />
      )}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { t } = useTranslation();
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? ["Language"] : []),
    ...(theme !== "system" ? ["Theme"] : []),
    ...(!followSystem ? ["Follow system"] : []),
    ...(themeHalves !== null ? ["Theme mix"] : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? ["Contrast"]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? ["Diff colors"]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? ["Chat width"] : []),
    ...(settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay
      ? ["Effort display"]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? ["Render math"]
      : []),
    ...(settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs
      ? ["Panel animations"]
      : []),
    ...(settings.environmentIdentificationMode !==
    DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
      ? ["Environment identification"]
      : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? ["Time format"]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? ["Thread notifications"]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? ["In-app notifications"]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? ["Project Grouping"]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? ["Project order"]
      : []),
    ...(settings.sidebarWorkingShelfEnabled !== DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled
      ? ["Working section"]
      : []),
    ...(settings.sidebarAutoSettleAfterDays !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
      ? ["Auto-settle inactive threads"]
      : []),
    ...(settings.sidebarAutoSettleKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests
      ? ["Keep threads with a PR"]
      : []),
    ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
      ? ["Auto-settle merged threads"]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? ["Resume after usage limits"]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? ["Snooze until limits reset"]
      : []),
    ...(!Equal.equals(settings.snoozePresets, DEFAULT_UNIFIED_SETTINGS.snoozePresets)
      ? ["Snooze options"]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? ["Word wrap"] : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? ["Composer context"]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? ["Default diff file state"]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? ["Diff whitespace changes"]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? ["Diff layout"] : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? ["Open pull requests and changes panels proactively"]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? ["Show skills in slash menu"]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? ["Rich text composer"]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? ["Send shortcut"] : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? ["Follow-up behavior"]
      : []),
    ...(settings.contextWindowMeterEnabled !== DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled
      ? ["Context window indicator"]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? ["Response streaming"]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? ["Provider update checks"]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? ["Continue threads after restarts"]
      : []),
    ...(isBackgroundActivityDirty ? ["Background activity"] : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? ["New thread mode"]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? ["New worktrees start from remote"]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? ["Add project base directory"]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? ["Unpin confirmation"]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? ["Archive confirmation"]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? ["Delete confirmation"]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? ["Quit shortcut"] : []),
    ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
    ...(settings.threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions
      ? ["Thread title instructions"]
      : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? ["Agent browser access"]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Reset only dirty theme keys so storage failures cannot block other settings; re-read after confirmation
    // for safe rollback.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settings.text.couldnTRestoreThemeSettings"),
          description: t("settings.text.tryAgain2"),
        }),
      );
    };
    // Restore the base preference before the mix because restoring the base clears the mix.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      language: DEFAULT_UNIFIED_SETTINGS.language,
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
      effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      contextWindowMeterEnabled: DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      snoozePresets: DEFAULT_UNIFIED_SETTINGS.snoozePresets,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  const [draftSource, setDraftSource] = useState(value);
  if (draftSource !== value) {
    setDraftSource(value);
    setDraft(String(value));
  }

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
          parsed <= MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label={t("settings.text.daysOfInactivityBeforeAutoSettle")}
    />
  );
}

export function LegacyFeaturesSection() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsSection id="legacy-features" title={t("settings.text.legacy")}>
      <SettingsRow
        {...searchableSetting("legacy-plan-mode")}
        description={t("settings.text.restoreBuildPlanPlanDefaultAnd")}
        control={
          <Switch
            checked={settings.planModeEnabled}
            onCheckedChange={(checked) => {
              updateSettings({ planModeEnabled: Boolean(checked) });
            }}
            aria-label={t("settings.text.planModeLegacy")}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("legacy-context-window-indicator")}
        description={t("settings.text.showsContextWindowUsageAsA")}
        control={
          <Switch
            checked={settings.contextWindowMeterEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ contextWindowMeterEnabled: Boolean(checked) })
            }
            aria-label={t("settings.text.contextWindowIndicatorLegacy")}
          />
        }
      />
    </SettingsSection>
  );
}

const LANGUAGE_LABELS = { en: "English", "zh-CN": "简体中文" } as const;

/** Settings > General is the only translated panel, so only it gets a localized reset button. */
function GeneralResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingResetButton
      label={label}
      ariaLabel={t("settings.resetLabel", { label })}
      tooltip={t("settings.resetToDefault")}
      onClick={onClick}
    />
  );
}

export function GeneralSettingsPanel() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const languageLabel = (language: AppLanguage) =>
    language === "system" ? t("settings.general.language.system") : LANGUAGE_LABELS[language];

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("settings.general.language.section")}>
        <SettingsRow
          {...searchableSetting("language", t)}
          description={t("settings.general.language.description")}
          resetAction={
            settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? (
              <GeneralResetButton
                label={t("settings.general.language.reset")}
                onClick={() => updateSettings({ language: DEFAULT_UNIFIED_SETTINGS.language })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.language}
              onValueChange={(value) => {
                if (isAppLanguage(value)) updateSettings({ language: value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.items.language")}
              >
                <SelectValue>{languageLabel(settings.language)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {AppLanguage.literals.map((language) => (
                  <SelectItem hideIndicator key={language} value={language}>
                    {languageLabel(language)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="notifications" title={t("settings.general.notifications.section")}>
        <NotificationSettings />
        <SettingsRow
          {...searchableSetting("in-app-notifications", t)}
          description={t("settings.general.notifications.inAppDescription")}
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={t("settings.items.in-app-notifications")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="sidebar" title={t("settings.general.sidebar.section")}>
        <SettingsRow
          {...searchableSetting("project-grouping", t)}
          description={t("settings.general.sidebar.projectGroupingDescription")}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <GeneralResetButton
                label={t("settings.general.sidebar.projectGroupingReset")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={t("settings.items.project-grouping")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("project-order", t)}
          description={t("settings.general.sidebar.projectOrderDescription")}
          resetAction={
            settings.sidebarProjectSortOrder !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
              <GeneralResetButton
                label={t("settings.general.sidebar.projectOrderReset")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (isSidebarProjectSortOrder(value)) {
                  updateSettings({ sidebarProjectSortOrder: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings.items.project-order")}
              >
                <SelectValue>
                  {t(`settings.general.sidebar.projectOrder.${settings.sidebarProjectSortOrder}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarProjectSortOrder.literals.map((sortOrder) => (
                  <SelectItem hideIndicator key={sortOrder} value={sortOrder}>
                    {t(`settings.general.sidebar.projectOrder.${sortOrder}`)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("working-shelf", t)}
          description={t("settings.general.sidebar.workingShelfDescription")}
          resetAction={
            settings.sidebarWorkingShelfEnabled !==
            DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled ? (
              <GeneralResetButton
                label={t("settings.general.sidebar.workingShelfReset")}
                onClick={() =>
                  updateSettings({
                    sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarWorkingShelfEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarWorkingShelfEnabled: Boolean(checked) })
              }
              aria-label={t("settings.items.working-shelf")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={t("settings.general.confirmations.section")}>
        <SettingsRow
          {...searchableSetting("unpin-confirmation", t)}
          description={t("settings.general.confirmations.unpinDescription")}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <GeneralResetButton
                label={t("settings.general.confirmations.unpinReset")}
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={t("settings.general.confirmations.unpinAria")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("archive-confirmation", t)}
          description={t("settings.general.confirmations.archiveDescription")}
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <GeneralResetButton
                label={t("settings.general.confirmations.archiveReset")}
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={t("settings.general.confirmations.archiveAria")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("delete-confirmation", t)}
          description={t("settings.general.confirmations.deleteDescription")}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <GeneralResetButton
                label={t("settings.general.confirmations.deleteReset")}
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={t("settings.general.confirmations.deleteAria")}
            />
          }
        />
        {isElectron ? (
          <SettingsRow
            {...searchableSetting("quit-confirmation", t)}
            description={t("settings.general.confirmations.quitDescription")}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <GeneralResetButton
                  label={t("settings.general.confirmations.quitReset")}
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={t("settings.general.confirmations.quitAria")}
                >
                  <SelectValue>
                    {t(`settings.general.confirmations.quit.${settings.confirmQuit}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {QuitConfirmationMode.literals.map((value) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {t(`settings.general.confirmations.quit.${value}`)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="display" title={t("settings.general.display.section")}>
        <SettingsRow
          {...searchableSetting("time-format", t)}
          description={t("settings.general.display.timeFormatDescription")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <GeneralResetButton
                label={t("settings.general.display.timeFormatReset")}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.general.display.timeFormatAria")}
              >
                <SelectValue>
                  {t(`settings.general.display.timeFormat.${settings.timestampFormat}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {t("settings.general.display.timeFormat.locale")}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {t("settings.general.display.timeFormat.12-hour")}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {t("settings.general.display.timeFormat.24-hour")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ChatSettingsPanel() {
  const { t } = useTranslation();
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    {
      value: "mod-enter-multiline",
      label: t("settings.text.modifierlabelEnterForMultilinePrompts", { modifierLabel }),
    },
    { value: "mod-enter", label: t("settings.text.modifierlabelEnterAlways", { modifierLabel }) },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="composer" title={t("settings.text.composer")}>
        <SettingsRow
          {...searchableSetting("composer-rich-text")}
          description={t("settings.text.showFormattedMarkdownAsYouType")}
          resetAction={
            settings.composerRichTextEnabled !==
            DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
              <SettingResetButton
                label={t("settings.text.richTextComposer")}
                onClick={() =>
                  updateSettings({
                    composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerRichTextEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ composerRichTextEnabled: Boolean(checked) })
              }
              aria-label={t("settings.text.richTextComposer2")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("send-shortcut")}
          description={t("settings.text.chooseWhenEnterSendsAPrompt")}
          resetAction={
            settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
              <SettingResetButton
                label={t("settings.text.sendShortcut")}
                onClick={() =>
                  updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sendShortcut}
              onValueChange={(value) => {
                const option = sendShortcutOptions.find((option) => option.value === value);
                if (option) updateSettings({ sendShortcut: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label={t("settings.text.sendShortcut2")}
              >
                <SelectValue>
                  {
                    sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <AdvancedSettings targetIds={[searchableSetting("skills-in-slash-menu").id]}>
          <SettingsRow
            {...searchableSetting("skills-in-slash-menu")}
            description={t("settings.text.alsoIncludeSkillsInTheCommand")}
            resetAction={
              settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
                <SettingResetButton
                  label={t("settings.text.skillsInSlashMenu")}
                  onClick={() =>
                    updateSettings({
                      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.showSkillsInSlashMenu}
                onCheckedChange={(checked) =>
                  updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
                }
                aria-label={t("settings.text.showSkillsInSlashMenu")}
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <SettingsSection id="follow-ups" title={t("settings.text.followUps")}>
        <SettingsRow
          {...searchableSetting("follow-up-behavior")}
          description={
            "Queue follow-ups while the agent runs or steer the current run. " +
            (settings.sendShortcut === "mod-enter-multiline"
              ? `Press ${modifierLabel} + Enter for single-line prompts or ${modifierLabel} + Shift + Enter for multiline prompts to do the opposite for one message.`
              : `Press ${modifierLabel}${settings.sendShortcut === "mod-enter" ? " + Shift" : ""} + Enter to do the opposite for one message.`)
          }
          resetAction={
            settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
              <SettingResetButton
                label={t("settings.text.followUpBehavior")}
                onClick={() =>
                  updateSettings({
                    followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.followUpBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "steer") {
                  updateSettings({ followUpBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={t("settings.text.followUpBehavior2")}
              >
                <SelectValue>
                  {settings.followUpBehavior === "queue"
                    ? t("settings.text.queue")
                    : t("settings.text.steer")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="queue">{t("settings.text.queue")}</SelectItem>
                <SelectItem value="steer">{t("settings.text.steer")}</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function DiffColorsSettingsRow() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("diff-color-scheme")}
      description={t("settings.text.chooseColorsForAdditionsAndDeletions")}
      resetAction={
        settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
          <SettingResetButton
            label={t("settings.text.diffColors")}
            onClick={() =>
              updateSettings({ diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme })
            }
          />
        ) : null
      }
      control={
        <div className="w-full sm:w-40">
          <Select
            value={settings.diffColorScheme}
            onValueChange={(value) => {
              if (value === "red-green" || value === "blue-orange")
                updateSettings({ diffColorScheme: value });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full min-w-0"
              aria-label={t("settings.text.diffColors2")}
            >
              <span
                aria-hidden="true"
                className={
                  settings.diffColorScheme === "blue-orange"
                    ? "flex shrink-0 flex-row-reverse gap-1"
                    : "flex shrink-0 gap-1"
                }
              >
                <span className="size-2 rounded-full bg-diff-deletion" />
                <span className="size-2 rounded-full bg-diff-addition" />
              </span>
              <SelectValue>
                {settings.diffColorScheme === "blue-orange"
                  ? t("settings.text.blueOrange")
                  : t("settings.text.redGreen")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="red-green">{t("settings.text.redGreenDefault")}</SelectItem>
              <SelectItem value="blue-orange">{t("settings.text.blueOrange")}</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}

export function DiffsSettingsPanel() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="diffs" title={t("settings.text.diffs")}>
        <SettingsRow
          {...searchableSetting("diff-layout")}
          description={t("settings.text.showDiffsStackedOrSideBy")}
          resetAction={
            settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? (
              <SettingResetButton
                label={t("settings.text.diffLayout")}
                onClick={() => updateSettings({ diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateSettings({ diffLayout: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.text.diffLayout2")}
              >
                <SelectValue>{DIFF_LAYOUT_LABELS[settings.diffLayout]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="stacked">
                  {DIFF_LAYOUT_LABELS.stacked}
                </SelectItem>
                <SelectItem hideIndicator value="split">
                  {DIFF_LAYOUT_LABELS.split}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          description={t("settings.text.setWhetherTheDiffPanelIgnores")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label={t("settings.text.diffWhitespaceChanges")}
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={t("settings.text.hideWhitespaceChangesByDefault")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("default-diff-file-state")}
          description={t("settings.text.startWithFilesExpandedOrCollapsed")}
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                label={t("settings.text.defaultDiffFileState")}
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              onValueChange={(value) => {
                if (value === "expanded" || value === "collapsed") {
                  updateSettings({ diffFilesCollapsed: value === "collapsed" });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.text.defaultDiffFileState2")}
              >
                <SelectValue>
                  {settings.diffFilesCollapsed
                    ? t("settings.text.collapsed")
                    : t("settings.text.expanded")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="expanded">
                  {t("settings.text.expanded")}
                </SelectItem>
                <SelectItem hideIndicator value="collapsed">
                  {t("settings.text.collapsed")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <DiffColorsSettingsRow />
      </SettingsSection>

      <SettingsSection id="pull-requests" title={t("settings.text.pullRequests")}>
        <SettingsRow
          {...searchableSetting("proactive-panels")}
          description={t("settings.text.openLinkedPullRequestsFirstOtherwise")}
          resetAction={
            settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
              <SettingResetButton
                label={t("settings.text.proactivePanels")}
                onClick={() =>
                  updateSettings({
                    proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.proactivePanelsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ proactivePanelsEnabled: Boolean(checked) })
              }
              aria-label={t("settings.text.openPullRequestsAndChangesPanels")}
            />
          }
        />
        <PullRequestLinksOpenInAppSetting />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

/** The Providers panel can render without a settings scope, as its tests do; this row needs one. */
export function CompactIdleThreadsRow() {
  return useOptionalSettingsScope() === null ? null : <ScopedCompactIdleThreadsRow />;
}

function ScopedCompactIdleThreadsRow() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["idleCompaction", "compactIdleThreads"]}
      mixed={idleCompaction.mixed}
      {...searchableSetting("compact-idle-threads")}
      description={t("settings.text.whenToCompactAnIdleClaude")}
      resetAction={
        globalIdleCompaction(settings) !== globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) ? (
          <SettingResetButton
            label={t("settings.text.compactIdleThreads")}
            onClick={() =>
              updateSettings({ idleCompaction: globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) })
            }
          />
        ) : null
      }
      control={
        <Select
          value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
          onValueChange={(value) => {
            const mode = IDLE_COMPACTION_MODES.find((candidate) => candidate.value === value);
            if (mode) updateSettings({ idleCompaction: mode.value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={t("settings.text.compactIdleThreads2")}
          >
            <SelectValue>
              {(value: string | null) =>
                value === null
                  ? "Mixed"
                  : IDLE_COMPACTION_MODES.find((mode) => mode.value === value)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {IDLE_COMPACTION_MODES.map((mode) => (
              <SelectItem
                hideIndicator
                key={mode.value}
                value={mode.value}
                // A server from before modes has only the on/off switch, so it cannot store "Never".
                disabled={mode.value === "off" && !idleCompaction.neverAvailable}
              >
                {mode.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function ThreadsSettingsPanel() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, target, scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (target) => target.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );

  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = providerInstanceEntriesFor(
    textGenerationProviders,
    settings,
    target?.projectId ?? null,
  );
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      <SettingsSection id="new-projects" title={t("settings.text.newProjects")}>
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...searchableSetting("add-project-starts-in")}
          description={t("settings.text.leaveEmptyToUseWhenThe")}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label={t("settings.text.addProjectBaseDirectory")}
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              normalizeDraft={resolvePastedPath}
              placeholder={mixedAddProjectBaseDirectory ? t("settings.text.mixed") : "~/"}
              spellCheck={false}
              aria-label={t("settings.text.addProjectBaseDirectory2")}
            />
          }
        />
      </SettingsSection>

      <ProjectDefaultsSettings category="general" />

      {!isProjectScope ? (
        <SettingsSection id="snooze" title={t("settings.text.snooze")}>
          <SnoozePresetsRow />
        </SettingsSection>
      ) : null}

      <SettingsSection id="usage-limits" title={t("settings.text.usageLimits")}>
        <SettingsRow
          serverScoped
          {...searchableSetting("auto-resume-limited-threads")}
          description={t("settings.text.automaticallyResumeThreadsWhenTheirUsage")}
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={t("settings.text.resumeAfterUsageLimits")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("snooze-limited-threads")}
          description={t("settings.text.snoozeThreadsUntilTheirUsageLimits")}
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={t("settings.text.snoozeUntilLimitsReset")}
            />
          }
        />
      </SettingsSection>

      {hasServerTargets ? (
        <SettingsSection id="auto-settle" title={t("settings.text.autoSettle")}>
          <SettingsRow
            serverScoped
            settingKeys={["sidebarAutoSettleOnMerge"]}
            {...searchableSetting("auto-settle-merged-threads")}
            description={t("settings.text.settleAThreadWhenItsPull")}
            resetAction={
              settings.sidebarAutoSettleOnMerge !==
              DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge ? (
                <SettingResetButton
                  label={t("settings.text.autoSettleOnMerge")}
                  onClick={() =>
                    updateSettings({
                      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
                    })
                  }
                />
              ) : null
            }
            control={
              <ScopedSwitch
                settingKeys={["sidebarAutoSettleOnMerge"]}
                checked={settings.sidebarAutoSettleOnMerge}
                onCheckedChange={(checked) =>
                  updateSettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
                }
                aria-label={t("settings.text.autoSettleMergedThreads")}
              />
            }
          />

          <SettingsRow
            serverScoped
            settingKeys={["sidebarAutoSettleAfterDays"]}
            {...searchableSetting("auto-settle-inactive-threads")}
            description={t("settings.text.sidebarThreadsWithNoActivityFor")}
            resetAction={
              settings.sidebarAutoSettleAfterDays !==
              DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ? (
                <SettingResetButton
                  label="auto-settle"
                  onClick={() =>
                    updateSettings({
                      sidebarAutoSettleAfterDays:
                        DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
                    })
                  }
                />
              ) : null
            }
            control={
              <ScopedSwitch
                settingKeys={["sidebarAutoSettleAfterDays"]}
                checked={settings.sidebarAutoSettleAfterDays !== null}
                onCheckedChange={(checked) =>
                  updateSettings({
                    sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                  })
                }
                aria-label={t("settings.text.autoSettleInactiveThreads")}
              />
            }
          />
          {settings.sidebarAutoSettleAfterDays !== null ? (
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              title={searchableSetting("days-before-auto-settle").title}
              description={t("settings.text.anyNewActivityUnSettlesA")}
              control={
                <AutoSettleDaysInput
                  value={settings.sidebarAutoSettleAfterDays}
                  onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                />
              }
            />
          ) : null}
          {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleKeepPullRequests"]}
              title={t("settings.text.keepThreadsWithAPr")}
              description={t("settings.text.inactivityDoesNotSettleThreadsWith")}
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                  checked={settings.sidebarAutoSettleKeepPullRequests}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoSettleKeepPullRequests: checked })
                  }
                  aria-label={t("settings.text.keepThreadsWithAPr")}
                />
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection id="text-generation" title={t("settings.text.textGeneration")}>
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...searchableSetting("text-generation-model")}
          description={t("settings.text.usedForThreadTitlesAndOther")}
          resetAction={
            hasServerTargets && isTextGenerationModelDirty ? (
              <SettingResetButton
                label={t("settings.text.textGenerationModel")}
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            !hasServerTargets ? (
              <span className="text-sm text-muted-foreground">
                {t("settings.text.connectAnEnvironmentToChooseIts")}
              </span>
            ) : !hasTextGenerationProvider ? (
              <span className="text-sm text-muted-foreground">
                {t("settings.text.noTextGenerationProvidersAvailable")}
              </span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  lockedProvider={null}
                  instanceEntries={textGenerationModelInstanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(mixedTextGenerationModel ? { triggerLabel: t("settings.text.mixed") } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: t("settings.text.textGenerationModelNotSaved"),
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: createModelSelection(instanceId, model),
                        },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={textGenProvider}
                    models={textGenInstanceEntry?.models ?? []}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    allowPromptInjectedEffort={false}
                    planModeEnabled={
                      settings.planModeEnabled || selectsPlanAgent(textGenModelOptions)
                    }
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(
                              textGenInstanceId,
                              textGenModel,
                              nextOptions,
                            ),
                          },
                          textGenerationProviders,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
        <AdvancedSettings
          targetIds={[
            searchableSetting("thread-title-instructions").id,
            searchableSetting("response-streaming").id,
          ]}
        >
          <ThreadTitleInstructionsSettings />
          <SettingsRow
            serverScoped
            settingKeys={["responseStreamingMode"]}
            {...searchableSetting("response-streaming")}
            description={
              mixedResponseStreamingMode
                ? t("settings.text.theSelectedTargetsUseDifferentStreaming")
                : RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode]
            }
            resetAction={
              settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
                <SettingResetButton
                  label={t("settings.text.responseStreaming")}
                  onClick={() =>
                    updateSettings({
                      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
                onValueChange={(value) => {
                  if (value === "turn" || value === "paragraph") {
                    updateSettings({ responseStreamingMode: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label={t("settings.text.responseStreaming2")}
                >
                  <SelectValue>
                    {(value: ResponseStreamingMode | null) =>
                      value === null ? "Mixed" : RESPONSE_STREAMING_MODE_LABELS[value]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="turn">
                    {RESPONSE_STREAMING_MODE_LABELS.turn}
                  </SelectItem>
                  <SelectItem hideIndicator value="paragraph">
                    {RESPONSE_STREAMING_MODE_LABELS.paragraph}
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </AdvancedSettings>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function MaintenanceSettingsPanel() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { scope, environment, connectedEnvironments } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;

  return (
    <SettingsPageContainer>
      <SettingsSection id="updates" title={t("settings.text.updates")}>
        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...searchableSetting("provider-update-checks")}
          description={t("settings.text.checkInstalledProviderClisForNewer")}
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label={t("settings.text.providerUpdateChecks")}
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={t("settings.text.checkProviderVersions")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("continue-threads-after-server-update")}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description={t("settings.text.automaticallyResumeInterruptedThreadsAfterAn")}
          status={
            !hasServerTargets
              ? "All selected connected environments must support restart continuation."
              : undefined
          }
          resetAction={
            hasServerTargets &&
            settings.continueThreadsAfterServerUpdate !==
              DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
              <SettingResetButton
                label={t("settings.text.continueThreadsAfterRestarts")}
                onClick={() =>
                  updateSettings({
                    continueThreadsAfterServerUpdate:
                      DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!hasServerTargets}
              onCheckedChange={(checked) =>
                updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
              }
              aria-label={t("settings.text.continueThreadsAfterRestarts2")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="background" title={t("settings.text.backgroundActivity3")}>
        <BackgroundActivitySettingsRow />
      </SettingsSection>

      <StorageCleanupSections />

      <SettingsSection id="diagnostics-section" title={t("settings.text.diagnostics")}>
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={
            isEnvironmentScope
              ? t("settings.text.inspectProcessesResourceUseAndLogs")
              : t("settings.text.inspectProcessesResourceUseAndLogs2")
          }
          control={
            <Button
              render={
                <Link to="/settings/diagnostics" search={{ machine: environmentId ?? undefined }} />
              }
              size="sm"
              variant="outline"
            >
              {t("settings.text.viewDiagnostics")}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function AboutSettingsPanel() {
  const { t } = useTranslation();
  const primaryPolicy = usePrimaryManagedPolicy();
  const telemetryOff = managedTelemetryOffMessage(primaryPolicy);
  return (
    <SettingsPageContainer>
      <SettingsSection id="about" title={t("settings.text.app")}>
        {primaryPolicy ? (
          <SettingsRow
            title={t("settings.text.organization")}
            description={t("settings.text.thisEnvironmentIsManagedByOrganization", {
              organization: primaryPolicy.organization,
            })}
            control={
              primaryPolicy.supportUrl ? (
                <Button
                  render={
                    <a href={primaryPolicy.supportUrl} target="_blank" rel="noreferrer noopener" />
                  }
                  size="sm"
                  variant="outline"
                >
                  {t("settings.text.getHelp")}
                </Button>
              ) : null
            }
          />
        ) : null}
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <>
            <SettingsRow
              id={searchableSetting("app-version").id}
              title={<AboutVersionTitle />}
              description={t("settings.text.currentVersionOfTheApplication")}
            />
          </>
        )}
        <MobileAppSettingsRow />
      </SettingsSection>

      <SettingsSection id="legal" title={t("settings.text.legal")}>
        <SettingsRow
          {...searchableSetting("privacy-policy")}
          description={
            telemetryOff === undefined
              ? t("settings.text.howWeHandleYourDataIncluding")
              : t("settings.text.howWeHandleYourDataTelemetryoff", { telemetryOff })
          }
          control={
            <Button
              render={<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener" />}
              size="sm"
              variant="outline"
            >
              {t("settings.text.viewPolicy")}
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("open-source-licenses")}
          description={t("settings.text.noticesForDependenciesAssetsAndOptional")}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              {t("settings.text.viewLicenses")}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
