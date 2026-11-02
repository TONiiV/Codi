import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS, settingsSectionLabel, type SettingsPath } from "./settingsSearch";

function settingsBreadcrumbLabel(pathname: string, t: TFunction): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPathname in SETTINGS_SECTION_LABELS) {
    return settingsSectionLabel(normalizedPathname as SettingsPath, t);
  }
  return normalizedPathname === "/settings/open-source-licenses" ? "Open source licenses" : null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  const sectionLabel = settingsBreadcrumbLabel(pathname, t);

  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{t("settings.title")}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionLabel ?? t("settings.title")}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
