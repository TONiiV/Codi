import { msg, useMessages } from "gt-react";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS, settingsSectionLabel, type SettingsPath } from "./settingsSearch";

const SETTINGS_LABEL = msg("Settings");

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/open-source-licenses": msg("Open source licenses"),
};

function settingsBreadcrumbLabel(pathname: string): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPathname in SETTINGS_SECTION_LABELS) {
    return settingsSectionLabel(normalizedPathname as SettingsPath, t);
  }
  return normalizedPathname === "/settings/open-source-licenses"
    ? t("settings.openSourceLicenses")
    : null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const m = useMessages();
  const sectionLabel = settingsBreadcrumbLabel(pathname);

  return (
    <WorkspaceBreadcrumb ariaLabel={t("settings.breadcrumbLabel")}>
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{m(SETTINGS_LABEL)}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {m(sectionLabel ?? SETTINGS_LABEL)}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
