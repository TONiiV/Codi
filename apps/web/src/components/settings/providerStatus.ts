import type {
  ServerProvider,
  ServerProviderVersionAdvisory,
  ServerProviderCompatibilityAdvisory,
} from "@t3tools/contracts";
import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import type { TFunction } from "i18next";

import { englishT } from "~/i18n/englishT";

export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  neutral: {
    dot: "bg-muted-foreground",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

// Antigravity's local health check verifies installation, not Google sign-in.
// API-key and Agent Platform warnings still need attention.
function isAntigravitySignInUnchecked(provider: ServerProvider): boolean {
  return (
    provider.driver === "antigravity" &&
    provider.installed &&
    provider.status === "warning" &&
    provider.auth.status === "unknown" &&
    (provider.auth.type === undefined ||
      provider.auth.type === "oauth-personal" ||
      provider.auth.type === "oauth-business")
  );
}

export function getProviderStatusKey(provider: ServerProvider | undefined): ProviderStatusKey {
  if (provider && !provider.enabled) return "disabled";
  if (provider && isAntigravitySignInUnchecked(provider)) return "neutral";
  return provider?.status ?? "warning";
}

export function getProviderSummary(provider: ServerProvider | undefined, t: TFunction = englishT) {
  if (!provider) {
    return {
      headline: t("settings.text.checkingProviderStatus"),
      detail: t("settings.text.waitingForTheServerToReport"),
    };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: t("settings.text.disabled"),
      detail: provider.message ?? t("settings.text.thisProviderIsInstalledButDisabled"),
    };
  }
  if (!provider.installed) {
    return {
      headline: t("settings.text.notFound"),
      detail: provider.message ?? t("settings.text.cliNotDetectedOnPath"),
    };
  }
  if (provider.auth.status === "unauthenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? t("settings.manual.providerStatus.notAuthenticatedWith", { authLabel })
        : t("settings.manual.providerStatus.notAuthenticated"),
      detail: provider.message ?? null,
    };
  }
  if (isAntigravitySignInUnchecked(provider)) {
    return {
      headline: t("settings.text.installedSignInNotChecked"),
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: t("settings.text.needsAttention"),
      detail: provider.message ?? t("settings.text.theProviderIsInstalledButThe"),
    };
  }
  if (provider.status === "error") {
    return {
      headline: t("settings.text.unavailable"),
      detail: provider.message ?? t("settings.text.theProviderFailedItsStartupChecks"),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? t("settings.manual.providerStatus.authenticatedWith", { authLabel })
        : t("settings.manual.providerStatus.authenticated"),
      detail: provider.message ?? null,
    };
  }
  return {
    headline: t("settings.text.available"),
    detail: provider.message ?? null,
  };
}

export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  const antigravity = /^agy_acp_server_(\d{4})(\d{2})(\d{2})_\d+(?:_(\w+))?$/.exec(version);
  if (antigravity) {
    const [, year, month, day, candidate] = antigravity;
    return `${year}-${month}-${day}${candidate ? ` ${candidate}` : ""}`;
  }
  return /^\d/.test(version) ? `v${version}` : version;
}

const COMPATIBILITY_TITLES = {
  graceful: "settings.manual.providerStatus.limitedSupport",
  unsupported: "settings.manual.providerStatus.unsupportedVersion",
  broken: "settings.manual.providerStatus.brokenVersion",
} as const;

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  compatibility?: ServerProviderCompatibilityAdvisory | undefined,
  showCompatibility = true,
  t: TFunction = englishT,
): {
  readonly title: string;
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
  readonly targetVersion: string | null;
} | null {
  const latestIsIncompatible =
    compatibility?.latestVersionStatus === "broken" ||
    compatibility?.latestVersionStatus === "unsupported";
  if (
    showCompatibility &&
    compatibility &&
    (compatibility.status === "graceful" ||
      compatibility.status === "unsupported" ||
      compatibility.status === "broken")
  ) {
    const targetVersion = compatibility.recommendedVersion;
    const recommendation = getProviderVersionLabel(targetVersion) ?? compatibility.recommendedRange;
    // Latest package versions cannot be updated into recommendations requiring another package.
    const isAlreadyLatest = advisory?.status === "current";
    return {
      title: t(COMPATIBILITY_TITLES[compatibility.status]),
      detail:
        compatibility.message ??
        (recommendation
          ? t("settings.manual.providerStatus.useForFullSupport", { recommendation })
          : t("settings.manual.providerStatus.updateForFullSupport")),
      updateCommand:
        targetVersion || latestIsIncompatible || isAlreadyLatest
          ? null
          : (advisory?.updateCommand ?? null),
      emphasis: compatibility.status === "graceful" ? "normal" : "strong",
      targetVersion,
    };
  }
  if (
    !advisory ||
    advisory.status === "current" ||
    advisory.status === "unknown" ||
    latestIsIncompatible
  ) {
    return null;
  }

  const label = t("settings.manual.providerStatus.updateAvailable");
  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    title: label,
    detail:
      advisory.message ??
      (versionLabel
        ? t("settings.manual.providerStatus.installVersion", { label, versionLabel })
        : t("settings.manual.providerStatus.installLatest", { label })),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
    targetVersion: null,
  };
}

const CONNECTION_PHASE_KEYS = {
  available: "settings.text.connectionAvailable",
  offline: "settings.text.connectionOffline",
  connecting: "settings.text.connectionConnecting",
  reconnecting: "settings.text.connectionReconnecting",
  connected: "settings.text.connectionConnected",
  unsupported: "settings.text.connectionUnsupported",
  error: "settings.text.connectionFailed",
} as const satisfies Record<EnvironmentConnectionPhase, string>;

/** client-runtime's `connectionStatusTitle`, translated; mobile shares that helper in English. */
export function connectionStatusTitleText(
  connection: EnvironmentConnectionPresentation,
  t: TFunction = englishT,
): string {
  return t(
    connection.phase === "reconnecting" && connection.error
      ? "settings.text.connectionReconnectingFailed"
      : CONNECTION_PHASE_KEYS[connection.phase],
  );
}
