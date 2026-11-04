import { SessionPermissions } from "./SessionPermissions";
import {
  ChevronRightIcon,
  ChevronsLeftRightEllipsisIcon,
  EllipsisIcon,
  RouteIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useState } from "react";
import {
  AuthRelayWriteScope,
  type EnvironmentId,
  connectReachabilityHelpUrl,
  formatConnectReachable,
  managedCapabilityDenial,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  connectionRoutes,
  hasSavedBearerRoute,
  connectionStatusText,
  environmentMcpUrl,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { EnvironmentIconMenu } from "./EnvironmentIconPicker";
import { EnvironmentRoutesList } from "./EnvironmentRoutesList";
import {
  ConnectionDiagnosisPanel,
  ConnectionDiagnosisSummary,
  useConnectionDiagnosis,
} from "./ConnectionDiagnosisDetails";
import { usePreparedConnection } from "~/state/session";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button, InlineButton } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import {
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
} from "~/versionSkew";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { useCloudLinkController } from "~/cloud/useCloudLinkController";
import { useManagedTunnelUsage } from "~/cloud/managedRelayState";
import { useT3ConnectAccountPage } from "../clerk/T3ConnectAccountPages";
import { TunnelLimitAlert, TunnelUsageMeter } from "../cloud/TunnelUsage";
import { environmentCatalog } from "~/connection/catalog";
import { readEnvironmentScope } from "~/state/session";
import {
  type EnvironmentPresentation,
  useRelayEnvironmentDiscovery,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { APP_VERSION } from "~/branding";
import { usePrimaryManagedPolicy } from "~/state/managedPolicy";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "~/state/server";
import {
  OutdatedServerUpdateAction,
  ServerUpdateAction,
  ServerUpdateProgress,
} from "../ServerUpdateAction";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { useTranslation } from "react-i18next";

type SavedBackendListRowProps = {
  environment: EnvironmentPresentation;
  removingEnvironmentId: EnvironmentId | null;
  onSetEnabled: (environmentId: EnvironmentId, enabled: boolean) => void;
  onRemove: (environment: EnvironmentPresentation) => void;
  onAddRoute: (environment: EnvironmentPresentation) => void;
};

function savedBackendStatus(environment: EnvironmentPresentation): {
  readonly text: string;
  readonly tone: "muted" | "error";
} {
  if (!environment.entry.enabled && environment.connection.phase !== "unsupported")
    return { text: "Off", tone: "muted" };
  const { connection } = environment;
  switch (connection.phase) {
    case "connected":
      return { text: "Connected", tone: "muted" };
    case "connecting":
      return { text: "Connecting", tone: "muted" };
    case "reconnecting":
      return {
        text: connection.error ? `Reconnecting: ${connection.error}` : "Reconnecting",
        tone: "error",
      };
    case "unsupported":
      return { text: "Client not supported", tone: "muted" };
    case "error":
      return {
        text: connection.error ? `Connection failed: ${connection.error}` : "Connection failed",
        tone: "error",
      };
    case "offline":
      return { text: "Offline", tone: "muted" };
    case "available":
      return { text: "Not connected", tone: "muted" };
  }
}

export function SavedBackendListRow({
  environment,
  removingEnvironmentId,
  onSetEnabled,
  onRemove,
  onAddRoute,
}: SavedBackendListRowProps) {
  const { t } = useTranslation();
  const [routesOpen, setRoutesOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const environmentId = environment.environmentId;
  const unsupported = environment.connection.phase === "unsupported";
  const blocked = unsupported && !hasSavedBearerRoute(environment.entry);
  const enabled = environment.entry.enabled && !unsupported;
  const isConnected = environment.connection.phase === "connected";
  const isRemoving = removingEnvironmentId === environmentId;
  const errorTraceId = environment.connection.traceId;
  const { copyToClipboard: copyTraceIdToClipboard } = useCopyToClipboard<{ traceId: string }>({
    target: "trace ID",
    onCopy: ({ traceId }) => {
      toastManager.add({
        type: "success",
        title: t("settings.text.traceIdCopied"),
        description: traceId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settings.text.couldNotCopyTraceId"),
          description: error.message,
        }),
      );
    },
  });
  const copyTraceId = (traceId: string) => {
    copyTraceIdToClipboard(traceId, { traceId });
  };
  const { copyToClipboard: copyMcpUrl } = useCopyToClipboard<{ url: string }>({
    target: "MCP URL",
    onCopy: ({ url }) => {
      toastManager.add({
        type: "success",
        title: t("settings.text.mcpUrlCopied"),
        description: t("settings.text.addItToAnAgentE", { url }),
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settings.text.couldNotCopyMcpUrl"),
          description: error.message,
        }),
      );
    },
  });
  const versionMismatch = resolveServerConfigVersionMismatch(environment.serverConfig);
  const serverUpdateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const resumingServerUpdate =
    serverUpdateState.status === "running" && serverUpdateState.stage === "resuming";
  const status = savedBackendStatus(environment);
  const serverVersion = environment.serverConfig?.environment.serverVersion ?? null;
  // Discovery empties its map on every refresh, so hold the last descriptor
  // seen or the glyph would blink back to the generic one each time.
  const relayDiscovery = useRelayEnvironmentDiscovery();
  const discoveredDescriptor = Option.getOrNull(
    relayDiscovery.environments.get(environmentId)?.status ?? Option.none(),
  )?.descriptor;
  const [lastDescriptor, setLastDescriptor] = useState(discoveredDescriptor);
  if (discoveredDescriptor !== undefined && discoveredDescriptor !== lastDescriptor) {
    setLastDescriptor(discoveredDescriptor);
  }
  const discoveredRelayHttpBaseUrl =
    relayDiscovery.environments.get(environmentId)?.environment.endpoint.httpBaseUrl;
  const [lastRelayHttpBaseUrl, setLastRelayHttpBaseUrl] = useState(discoveredRelayHttpBaseUrl);
  if (
    discoveredRelayHttpBaseUrl !== undefined &&
    discoveredRelayHttpBaseUrl !== lastRelayHttpBaseUrl
  ) {
    setLastRelayHttpBaseUrl(discoveredRelayHttpBaseUrl);
  }
  const retryNow = useAtomCommand(environmentCatalog.retryNow);
  const {
    diagnosis: currentDiagnosis,
    state: connectionState,
    relayOnly,
  } = useConnectionDiagnosis(environment);
  const diagnosis = resumingServerUpdate ? null : currentDiagnosis;
  const prepared = usePreparedConnection(environmentId);
  const connectedTarget = isConnected && prepared._tag === "Some" ? prepared.value.target : null;
  const mcpUrl = environmentMcpUrl({
    entry: environment.entry,
    relayHttpBaseUrl: discoveredRelayHttpBaseUrl ?? lastRelayHttpBaseUrl,
    connectedTarget,
  });
  const machineKind = resolveEnvironmentMachineKind(
    environment.serverConfig ??
      (lastDescriptor === undefined ? null : { environment: lastDescriptor }),
  );
  const routeCount = connectionRoutes(environment.entry).length;
  const subtitleText = [
    environmentTransportLabel(environment, connectedTarget),
    // The headline below names the failure in full.
    diagnosis ? null : resumingServerUpdate ? "Restarting" : status.text,
    enabled && versionMismatch ? serverVersion : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");

  const showUpdateAction =
    enabled &&
    isConnected &&
    versionMismatch !== null &&
    (serverUpdateState.status === "idle" || serverUpdateState.status === "failed");

  const statusTooltip = `${
    unsupported
      ? (environment.connection.error ?? connectionStatusText(environment.connection))
      : enabled
        ? connectionStatusText(environment.connection)
        : "Switched off"
  }${
    versionMismatch
      ? `\nUpdate available: ${versionMismatch.serverVersion} → ${versionMismatch.clientVersion}`
      : ""
  }`;

  return (
    <EnvironmentRow
      kind={machineKind}
      label={environment.label}
      dimmed={!enabled}
      subtitle={
        <span className="flex min-w-0 items-center gap-1">
          <Tooltip>
            {/* The status can change while the tooltip is open, and base-ui only
                re-measures the popup when the trigger's payload changes. */}
            <TooltipTrigger
              payload={statusTooltip}
              render={
                <span
                  className={cn(
                    "min-w-0 truncate",
                    enabled &&
                      status.tone === "error" &&
                      !resumingServerUpdate &&
                      !diagnosis &&
                      "text-destructive",
                  )}
                />
              }
            >
              {subtitleText}
            </TooltipTrigger>
            <TooltipPopup side="top" className="whitespace-pre-wrap">
              {statusTooltip}
            </TooltipPopup>
          </Tooltip>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <button
            type="button"
            aria-expanded={routesOpen}
            onClick={() => setRoutesOpen((open) => !open)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {routeCount === 1
              ? t("settings.text.routes")
              : t("settings.text.routecountRoutes", { routeCount })}
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                routesOpen && "rotate-90",
              )}
            />
          </button>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <button
            type="button"
            aria-expanded={permissionsOpen}
            aria-controls={`remote-permissions-${environmentId}`}
            onClick={() => setPermissionsOpen((open) => !open)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {t("settings.text.permissions")}
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                permissionsOpen && "rotate-90",
              )}
            />
          </button>
        </span>
      }
      below={
        <>
          {diagnosis ? (
            <ConnectionDiagnosisSummary
              diagnosis={diagnosis}
              retryAt={connectionState.phase === "backoff" ? connectionState.retryAt : null}
              attempt={connectionState.attempt}
              expanded={diagnosisOpen}
              onToggle={() => setDiagnosisOpen((open) => !open)}
            />
          ) : null}
          {serverUpdateState.status !== "idle" ? (
            <div className="mt-1 max-w-md">
              <ServerUpdateProgress state={serverUpdateState} />
            </div>
          ) : null}
        </>
      }
      detail={
        <>
          {diagnosis && diagnosisOpen ? (
            <ConnectionDiagnosisPanel
              hostLabel={environment.label}
              diagnosis={diagnosis}
              onRetry={() => void retryNow(environmentId)}
              onAddRoute={relayOnly ? () => onAddRoute(environment) : null}
            />
          ) : null}
          {routesOpen && (
            <EnvironmentRoutesList
              environment={environment}
              onAddRoute={() => onAddRoute(environment)}
            />
          )}
          {permissionsOpen && (
            <div
              id={`remote-permissions-${environmentId}`}
              className="mt-2 border-t border-border/50"
            >
              <SessionPermissions
                environmentId={environmentId}
                connected={isConnected}
                routeContext
              />
            </div>
          )}
        </>
      }
    >
      {unsupported &&
      environment.entry.serverUpdateRequired === true &&
      serverUpdateState.status !== "running" ? (
        <OutdatedServerUpdateAction
          environmentId={environmentId}
          serverLabel={t("settings.text.labelServer", { label: environment.label })}
          fromVersion={lastDescriptor?.serverVersion}
          targetVersion={APP_VERSION}
          label={
            serverUpdateState.status === "failed"
              ? t("settings.text.retryUpdate")
              : t("settings.text.update")
          }
        />
      ) : null}
      {showUpdateAction ? (
        <ServerUpdateAction
          environmentId={environmentId}
          serverLabel={t("settings.text.labelServer", { label: environment.label })}
          selfUpdate={resolveServerSelfUpdateCapability(environment.serverConfig)}
          installation={environment.serverConfig?.environment.capabilities.serverInstallation}
          desktopAppUpdate={supportsDesktopAppUpdate(environment.serverConfig)}
          targetVersion={versionMismatch.clientVersion}
          label={
            serverUpdateState.status === "failed"
              ? t("settings.text.retryUpdate")
              : t("settings.text.update")
          }
          appearance="icon"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Switch
              size="sm"
              checked={enabled}
              disabled={isRemoving || blocked}
              aria-label={`${enabled ? "Switch off" : "Switch on"} ${environment.label}`}
              onCheckedChange={(checked) => onSetEnabled(environmentId, checked)}
            />
          }
        />
        <TooltipPopup side="top">
          {blocked
            ? t("settings.text.clientNotSupported")
            : enabled
              ? t("settings.text.switchOff")
              : t("settings.text.switchOn")}
        </TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              disabled={isRemoving}
              aria-label={t("settings.text.moreActionsForLabel", { label: environment.label })}
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <EnvironmentIconMenu
            environmentId={environmentId}
            serverConfig={environment.serverConfig}
          />
          <MenuItem onClick={() => setRoutesOpen((open) => !open)}>
            <RouteIcon />
            {routesOpen ? t("settings.text.hideRoutes") : t("settings.text.routes")}
          </MenuItem>
          {mcpUrl ? (
            <MenuItem onClick={() => copyMcpUrl(mcpUrl, { url: mcpUrl })}>
              {t("settings.text.copyMcpUrl")}
            </MenuItem>
          ) : null}
          {errorTraceId ? (
            <MenuItem onClick={() => copyTraceId(errorTraceId)}>
              {t("settings.text.copyTraceId")}
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => onRemove(environment)}>
            {isRemoving ? t("settings.text.removing") : t("settings.text.removeFromThisDevice")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </EnvironmentRow>
  );
}

function CloudLinkSwitch({
  checked,
  disabled,
  disabledReason,
  onCheckedChange,
  ariaLabel = "Enable T3 Connect",
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly onCheckedChange?: (enabled: boolean) => void;
  readonly ariaLabel?: string;
}) {
  const control = (
    <Switch
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      {...(onCheckedChange ? { onCheckedChange } : {})}
    />
  );
  return disabledReason ? (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{control}</span>} />
      <TooltipPopup side="top">{disabledReason}</TooltipPopup>
    </Tooltip>
  ) : (
    control
  );
}

/** Tunnel meter, plus the upgrade prompt after the relay refuses a tunnel at the cap. */
function T3ConnectTunnelUsage({ tunnelLimit }: { readonly tunnelLimit: number | null }) {
  const { t } = useTranslation();
  const usage = useManagedTunnelUsage();
  const accountPage = useT3ConnectAccountPage();
  const openAccountPage = accountPage.open;
  // Usage when the relay refused. The relay also counts tunnels still being set up, so only
  // a freed tunnel or a higher cap clears the alert, not a meter that merely shows room.
  const [usedAtRefusal, setUsedAtRefusal] = useState<number | null>(null);
  if (tunnelLimit === null) {
    if (usedAtRefusal !== null) setUsedAtRefusal(null);
  } else if (usedAtRefusal === null && usage.used !== null) {
    setUsedAtRefusal(usage.used);
  }
  const showLimitAlert =
    tunnelLimit !== null &&
    !(usedAtRefusal !== null && usage.used !== null && usage.used < usedAtRefusal) &&
    !(usage.limit !== null && usage.limit > tunnelLimit);
  const meter =
    usage.used !== null && usage.limit !== null ? (
      <TunnelUsageMeter
        used={usage.used}
        limit={usage.limit}
        action={
          // At the cap the alert below carries the same action.
          usage.upgrade && openAccountPage && !showLimitAlert ? (
            <InlineButton onClick={() => openAccountPage("t3-chat")}>
              {t("settings.text.getMoreTunnels")}
            </InlineButton>
          ) : null
        }
      />
    ) : null;
  return (
    <>
      {meter || showLimitAlert ? (
        <div className="flex flex-col gap-3 pb-3">
          {meter}
          {showLimitAlert ? (
            <TunnelLimitAlert
              upgrade={usage.upgrade}
              onLinkT3Chat={openAccountPage ? () => openAccountPage("t3-chat") : null}
              onManageTunnels={openAccountPage ? () => openAccountPage("t3-connect") : null}
            />
          ) : null}
        </div>
      ) : null}
      {/* Kept outside the conditional so an open account page does not remount. */}
      {accountPage.portals}
    </>
  );
}

function ConfiguredCloudLinkRow({ canManageRelay }: { readonly canManageRelay: boolean }) {
  const { t } = useTranslation();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const {
    isSignedIn,
    linkState: primaryCloudLinkState,
    linkRevoked,
    managedTunnelActive,
    managedTunnelOutOfSync,
    publishAgentActivity,
    holdWebhooksWhileOffline,
    operationError,
    tunnelLimit,
    reconcileCloudState,
  } = useCloudLinkController();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  // The server unlinks and refuses relay changes under such a policy; unlinking stays possible.
  const connectDenial = managedCapabilityDenial(usePrimaryManagedPolicy(), "connect");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);

  const disabledReason = canManageRelay
    ? null
    : "Your session does not have permission to manage T3 Connect access.";
  const isBusy = isUpdating || isUpdatingPreference;
  const switchDisabled =
    !canManageRelay ||
    !isSignedIn ||
    primaryCloudLinkState.data === null ||
    primaryCloudLinkState.isPending ||
    isBusy;
  // `isSignedIn` is undefined until Clerk loads. Signed out, one row shows a
  // sign-in button instead of its switch; the onboarding dialog that opens after
  // a fresh sign-in offers both linking and publishing.
  const signedOut = isSignedIn === false;
  const signInButton = (
    <Button size="sm" variant="outline" onClick={openAuthPrompt}>
      {t("settings.text.signIn")}
    </Button>
  );
  const refreshLinkState = useEffectEvent(primaryCloudLinkState.refresh);
  // The server rechecks reachability when the tunnel's 30 s readiness poll changes.
  // Poll while mounted, so a failed read does not stop later ones.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- 30 s interval that refreshes the cloud link reachability while mounted
  useEffect(() => {
    const interval = window.setInterval(() => refreshLinkState(), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const reachability = managedTunnelActive ? primaryCloudLinkState.data?.reachability : undefined;
  const reachabilityStatus =
    reachability?.status === "reachable" ? (
      formatConnectReachable(reachability)
    ) : reachability?.status === "unreachable" ? (
      <span className="block text-destructive">
        {[reachability.reason, reachability.hint, `Fix: ${reachability.fix}`]
          .filter(Boolean)
          .join(" ")}{" "}
        <a
          href={connectReachabilityHelpUrl(reachability.cause)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {t("settings.text.moreInfo")}
        </a>
      </span>
    ) : null;

  const updateManagedTunnel = async (enabled: boolean) => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthRelayWriteScope)
    )
      return;
    setIsUpdating(true);
    const ok = await reconcileCloudState({ managedTunnel: enabled, publish: publishAgentActivity });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? t("settings.text.t3ConnectLinked")
          : publishAgentActivity
            ? t("settings.text.t3ConnectTunnelDisabled")
            : t("settings.text.t3ConnectUnlinked"),
        description: enabled
          ? t("settings.text.thisEnvironmentIsAvailableThroughT3")
          : publishAgentActivity
            ? t("settings.text.theManagedTunnelWasRemovedAgent")
            : t("settings.text.thisEnvironmentIsNoLongerAvailable"),
      });
    }
    setIsUpdating(false);
  };

  const updatePublishAgentActivity = async (enabled: boolean) => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthRelayWriteScope)
    )
      return;
    setIsUpdatingPreference(true);
    const ok = await reconcileCloudState({ managedTunnel: managedTunnelActive, publish: enabled });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? t("settings.text.agentActivityEnabled")
          : t("settings.text.agentActivityDisabled"),
        description: enabled
          ? t("settings.text.thisEnvironmentPublishesAgentActivityTo")
          : t("settings.text.thisEnvironmentWillStopPublishingAgent"),
      });
    }
    setIsUpdatingPreference(false);
  };

  const updateHoldWebhooks = async (enabled: boolean) => {
    setIsUpdatingPreference(true);
    const ok = await reconcileCloudState({
      managedTunnel: managedTunnelActive,
      publish: publishAgentActivity,
      holdWebhooksWhileOffline: enabled,
    });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? t("settings.text.webhooksHeldWhileOffline")
          : t("settings.text.webhooksNoLongerHeld"),
        description: enabled
          ? t("settings.text.t3ConnectKeepsWebhookRequestsFor")
          : t("settings.text.requestsToAnOfflineEnvironmentNow"),
      });
    }
    setIsUpdatingPreference(false);
  };

  return (
    <>
      {isElectron ? (
        <SettingsRow
          title={searchableSetting("t3-connect").title}
          description={
            connectDenial !== undefined && !managedTunnelActive
              ? connectDenial
              : signedOut
                ? t("settings.text.signInToMakeThisEnvironment")
                : linkRevoked
                  ? t("settings.text.thisEnvironmentWasRemovedFromT3")
                  : managedTunnelActive
                    ? reachability?.status === "unreachable"
                      ? t("settings.text.t3ConnectIsOnButOther")
                      : reachability?.status === "reachable"
                        ? t("settings.text.thisEnvironmentIsAvailableToYour")
                        : t("settings.text.t3ConnectIsOnReachabilityHas")
                    : managedTunnelOutOfSync
                      ? t("settings.text.t3ConnectIsOutOfSync")
                      : t("settings.text.makeThisEnvironmentAvailableToYour")
          }
          status={operationError ?? primaryCloudLinkState.error ?? reachabilityStatus}
          managed={managedTunnelActive ? undefined : connectDenial}
          control={
            signedOut ? (
              signInButton
            ) : (
              <CloudLinkSwitch
                checked={managedTunnelActive}
                disabled={switchDisabled}
                disabledReason={disabledReason}
                onCheckedChange={(enabled) => void updateManagedTunnel(enabled)}
              />
            )
          }
        >
          {signedOut || connectDenial !== undefined ? null : (
            <T3ConnectTunnelUsage tunnelLimit={tunnelLimit} />
          )}
        </SettingsRow>
      ) : linkRevoked ? (
        <SettingsRow
          title={searchableSetting("t3-connect").title}
          description={t("settings.text.thisEnvironmentWasRemovedFromT32")}
        />
      ) : null}
      {signedOut && isElectron ? null : (
        <SettingsRow
          title={searchableSetting("publish-agent-activity").title}
          description={
            signedOut
              ? t("settings.text.signInToSendActivityTo")
              : t("settings.text.sendActivityToMobileNotificationsAnd")
          }
          managed={connectDenial}
          control={
            signedOut ? (
              signInButton
            ) : (
              <CloudLinkSwitch
                ariaLabel={t("settings.text.publishAgentActivityToMobileClients")}
                checked={publishAgentActivity}
                disabled={switchDisabled}
                disabledReason={disabledReason}
                onCheckedChange={(enabled) => void updatePublishAgentActivity(enabled)}
              />
            )
          }
        />
      )}
      {managedTunnelActive && !signedOut ? (
        <SettingsRow
          title={searchableSetting("hold-webhooks-while-offline").title}
          description={t("settings.text.keepWebhookRequestsForUpTo")}
          managed={connectDenial}
          control={
            <CloudLinkSwitch
              ariaLabel={t("settings.text.holdWebhookRequestsWhileThisEnvironment")}
              checked={holdWebhooksWhileOffline}
              disabled={switchDisabled}
              disabledReason={disabledReason}
              onCheckedChange={(enabled) => void updateHoldWebhooks(enabled)}
            />
          }
        />
      ) : null}
    </>
  );
}

export function CloudLinkRow({
  canReadRelay,
  canManageRelay,
}: {
  readonly canReadRelay: boolean;
  readonly canManageRelay: boolean;
}) {
  const { t } = useTranslation();
  if (!hasCloudPublicConfig()) return null;
  if (!canReadRelay) {
    return (
      <SettingsRow
        title="T3 Connect"
        description={t("settings.text.toEditTheseSettingsPairThis")}
      />
    );
  }
  return <ConfiguredCloudLinkRow canManageRelay={canManageRelay} />;
}

function EmptyRemoteEnvironments({ cloudEnabled = true }: { readonly cloudEnabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <Empty className="min-h-52">
      <EmptyMedia variant="icon">
        <ChevronsLeftRightEllipsisIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{t("settings.text.noSavedRemoteEnvironments")}</EmptyTitle>
        <EmptyDescription>
          {cloudEnabled
            ? t("settings.text.clickAddEnvironmentToPairAnother")
            : t("settings.text.clickAddEnvironmentToPairAnother2")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function CloudRemoteEnvironmentRows({
  primaryEnvironmentId,
  savedEnvironments,
}: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly savedEnvironments: ReadonlyArray<EnvironmentPresentation>;
}) {
  return hasCloudPublicConfig() ? (
    <CloudEnvironmentConnectRows
      primaryEnvironmentId={primaryEnvironmentId}
      savedEnvironments={savedEnvironments}
      empty={<EmptyRemoteEnvironments />}
    />
  ) : savedEnvironments.length === 0 ? (
    <EmptyRemoteEnvironments cloudEnabled={false} />
  ) : null;
}
