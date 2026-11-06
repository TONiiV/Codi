import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { NotificationMode } from "@t3tools/contracts/settings";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const { t } = useTranslation();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<
    "needsHttps" | "unavailable" | "denied" | null
  >(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications", t)}
      description={t(`settings.general.notifications.${permissionMessage ?? "description"}`)}
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage("needsHttps");
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage("unavailable");
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage("denied");
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={t("settings.items.thread-notifications")}
          >
            <SelectValue>{t(`settings.general.notifications.mode.${mode}`)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {NotificationMode.literals.map((value) => (
              <SelectItem key={value} hideIndicator value={value}>
                {t(`settings.general.notifications.mode.${value}`)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
