import type { TFunction } from "i18next";
import {
  connectionRouteKind,
  connectionRouteLabel,
  routeHttpBaseUrl,
  type ConnectionRoute,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

function routeHostname(route: ConnectionRoute): string | null {
  const httpBaseUrl = routeHttpBaseUrl(route);
  if (httpBaseUrl === null) return null;
  try {
    return new URL(httpBaseUrl).hostname;
  } catch {
    return null;
  }
}

/** Route labels that are copy rather than a brand or protocol name, in the app language. */
export function connectionRouteText(route: ConnectionRoute, t: TFunction): string {
  switch (connectionRouteKind(route)) {
    case "loopback":
      return t("settings.text.thisDevice");
    case "public":
      return routeHostname(route) ?? t("settings.text.remoteLink");
    default:
      return connectionRouteLabel(route);
  }
}

export function connectionStatusLabel(
  connection: EnvironmentConnectionPresentation,
  t: TFunction,
): string {
  switch (connection.phase) {
    case "available":
      return t("settings.text.available");
    case "offline":
      return t("settings.text.offline");
    case "connecting":
      return t("settings.manual.envStatus.connecting");
    case "reconnecting":
      return connection.error
        ? t("settings.manual.envStatus.reconnectingError", { error: connection.error })
        : t("settings.manual.envStatus.reconnecting");
    case "connected":
      return t("settings.text.connected");
    case "unsupported":
      return t("settings.text.clientNotSupported");
    case "error":
      return connection.error
        ? t("settings.manual.envStatus.failedError", { error: connection.error })
        : t("settings.manual.envStatus.failed");
  }
}
