import { type EnvironmentId, sessionGrantsScope } from "@t3tools/contracts";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import { authScopeText, sessionPermissionsUnavailableText } from "./SettingsPanels.enumLabels";
import { useEnvironmentSessionState } from "~/state/session";
import { useTranslation } from "react-i18next";

export function SessionPermissions({
  environmentId,
  connected,
  routeContext = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly routeContext?: boolean;
}) {
  const { t } = useTranslation();
  const session = useEnvironmentSessionState(environmentId);
  return connected && !session.hasError && !session.isPending && session.data?.authenticated ? (
    <div className="space-y-3 py-3 text-xs">
      <p className="text-muted-foreground">
        {routeContext
          ? t("settings.text.thesePermissionsApplyToYourActive")
          : t("settings.text.thesePermissionsApplyToThisClient")}
      </p>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {AUTH_SCOPE_OPTIONS.map((option) => (
          <li key={option.scope} className="flex items-start justify-between gap-3">
            <span>{authScopeText(option, t).title}</span>
            <span className="shrink-0 text-muted-foreground">
              {sessionGrantsScope(session.data!, option.scope)
                ? t("settings.text.allowed")
                : t("settings.text.notGranted")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <p className="py-3 text-xs text-muted-foreground">
      {sessionPermissionsUnavailableText(
        {
          connected,
          failed: session.hasError,
          rejected:
            !session.hasError && !session.isPending && session.data?.authenticated === false,
        },
        t,
      )}
    </p>
  );
}
