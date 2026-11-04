import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useTranslation } from "react-i18next";

export function ThreadTitleInstructionsSettings() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["threadTitleInstructions"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadTitleInstructions"]}
      {...searchableSetting("thread-title-instructions")}
      description={t("settings.text.appendedToThePromptForNew")}
      resetAction={
        mixed || settings.threadTitleInstructions !== "" ? (
          <SettingResetButton
            label={t("settings.text.threadTitleInstructions")}
            onClick={() => updateSettings({ threadTitleInstructions: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.threadTitleInstructions}`}
          aria-label={t("settings.text.threadTitleInstructions2")}
          onChange={() => {
            edited.current = true;
          }}
          rows={4}
          defaultValue={mixed ? "" : settings.threadTitleInstructions}
          placeholder={
            mixed
              ? t("settings.text.mixedEnterInstructionsToApplyTo")
              : t("settings.text.keepTitlesToAFewWords")
          }
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.threadTitleInstructions))
              updateSettings({ threadTitleInstructions: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
