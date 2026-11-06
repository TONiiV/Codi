import { ChevronDownIcon } from "lucide-react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { ThreadDetailsItemsMenuItems } from "../chat/ThreadDetailsItemsMenu";
import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  RESET_THREAD_DETAILS_ITEMS,
  THREAD_DETAILS_ITEMS,
} from "../chat/threadDetailsItems";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { TranslatedSettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useTranslation } from "react-i18next";

export function ThreadDetailsItemsRow() {
  const { t } = useTranslation();
  const visibility = useClientSettings(resolveThreadDetailsVisibility);
  const enabled = THREAD_DETAILS_ITEMS.filter((item) => visibility[item.id]).length;
  return (
    <SettingsRow
      {...searchableSetting("thread-details-items", t)}
      description={t("settings.text.chooseWhatTheThreadDetailsCard")}
      resetAction={
        isDefaultThreadDetailsVisibility(visibility) ? null : (
          <TranslatedSettingResetButton
            label={t("settings.text.threadDetails")}
            onClick={() => updateClientSettings(RESET_THREAD_DETAILS_ITEMS)}
          />
        )
      }
      control={
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between sm:w-40"
                aria-label={t("settings.text.threadDetailsEnabledOfLengthOn", {
                  enabled,
                  length: THREAD_DETAILS_ITEMS.length,
                })}
              />
            }
          >
            {t("settings.text.enabledOfLengthOn", { enabled, length: THREAD_DETAILS_ITEMS.length })}
            <ChevronDownIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <ThreadDetailsItemsMenuItems />
          </MenuPopup>
        </Menu>
      }
    />
  );
}
