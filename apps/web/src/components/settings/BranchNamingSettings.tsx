import { useRef } from "react";
import { BranchNamingMode, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsRow, TranslatedSettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useTranslation } from "react-i18next";

const MODES = {
  static: "settings.parallelA.branchModeStatic",
  semantic: "settings.parallelA.branchModeSemantic",
  custom: "settings.manual.scwMode.custom.label",
} satisfies Record<BranchNamingMode, string>;

export function BranchNamingSettings() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const prefixEdited = useRef(false);
  const instructionsEdited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const modeMixed = useScopedSettingsMixed(["branchNamingMode"]);
  const prefixMixed = useScopedSettingsMixed(["branchNamePrefix"]);
  const instructionsMixed = useScopedSettingsMixed(["branchNameInstructions"]);

  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["branchNamingMode"]}
        {...searchableSetting("worktree-branch-naming", t)}
        description={t("settings.text.chooseHowNewWorktreeBranchesAre")}
        status={
          !modeMixed && settings.branchNamingMode === "semantic"
            ? t("settings.parallelA.branchSemanticStatus")
            : undefined
        }
        resetAction={
          settings.branchNamingMode !== DEFAULT_SERVER_SETTINGS.branchNamingMode || modeMixed ? (
            <TranslatedSettingResetButton
              label={t("settings.text.branchNaming")}
              onClick={() =>
                updateSettings({ branchNamingMode: DEFAULT_SERVER_SETTINGS.branchNamingMode })
              }
            />
          ) : null
        }
        control={
          <Select
            value={modeMixed ? null : settings.branchNamingMode}
            onValueChange={(value) => {
              if (BranchNamingMode.literals.includes(value as BranchNamingMode)) {
                updateSettings({ branchNamingMode: value as BranchNamingMode });
              }
            }}
          >
            <SelectTrigger size="sm" aria-label={t("settings.text.worktreeBranchNaming")}>
              <SelectValue>
                {(value: BranchNamingMode | null) =>
                  value === null ? t("settings.text.mixed") : t(MODES[value])
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {BranchNamingMode.literals.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(MODES[mode])}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {!modeMixed && settings.branchNamingMode === "static" ? (
        <SettingsRow
          serverScoped
          settingKeys={["branchNamePrefix"]}
          title={t("settings.text.branchPrefix")}
          description={t("settings.text.forExampleT3OrT3Produces")}
          resetAction={
            prefixMixed ||
            settings.branchNamePrefix !== DEFAULT_SERVER_SETTINGS.branchNamePrefix ? (
              <TranslatedSettingResetButton
                label={t("settings.text.branchPrefix2")}
                onClick={() =>
                  updateSettings({ branchNamePrefix: DEFAULT_SERVER_SETTINGS.branchNamePrefix })
                }
              />
            ) : null
          }
          control={
            <Input
              key={`${scopeKey}:${prefixMixed}:${settings.branchNamePrefix}`}
              aria-label={t("settings.text.branchPrefix")}
              autoCapitalize="none"
              spellCheck={false}
              onChange={() => {
                prefixEdited.current = true;
              }}
              placeholder={prefixMixed ? t("settings.text.mixed") : t("settings.text.noPrefix")}
              defaultValue={prefixMixed ? "" : settings.branchNamePrefix}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (prefixEdited.current && (prefixMixed || value !== settings.branchNamePrefix))
                  updateSettings({ branchNamePrefix: value });
                prefixEdited.current = false;
              }}
            />
          }
        />
      ) : null}
      {!modeMixed && settings.branchNamingMode === "custom" ? (
        <SettingsRow
          serverScoped
          settingKeys={["branchNameInstructions"]}
          title={t("settings.text.branchNamingInstructions")}
          description={t("settings.text.appendedToTheNamingPromptThe")}
          resetAction={
            instructionsMixed || settings.branchNameInstructions !== "" ? (
              <TranslatedSettingResetButton
                label={t("settings.text.branchNamingInstructions2")}
                onClick={() => updateSettings({ branchNameInstructions: "" })}
              />
            ) : null
          }
        >
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={`${scopeKey}:${instructionsMixed}:${settings.branchNameInstructions}`}
              aria-label={t("settings.text.branchNamingInstructions")}
              onChange={() => {
                instructionsEdited.current = true;
              }}
              rows={4}
              defaultValue={instructionsMixed ? "" : settings.branchNameInstructions}
              placeholder={
                instructionsMixed
                  ? t("settings.text.mixedEnterInstructionsToApplyTo")
                  : t("settings.text.useJuliusFollowedByTheIssue")
              }
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (
                  instructionsEdited.current &&
                  (instructionsMixed || value !== settings.branchNameInstructions)
                )
                  updateSettings({ branchNameInstructions: value });
                instructionsEdited.current = false;
              }}
            />
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}
