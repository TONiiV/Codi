import type { TFunction } from "i18next";
import {
  connectionRouteKind,
  connectionRouteLabel,
  routeHttpBaseUrl,
  type ConnectionRoute,
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
