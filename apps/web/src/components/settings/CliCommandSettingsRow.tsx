import { useState } from "react";

import {
  desktopCliCommandStateAtom,
  getDesktopCliCommandBridge,
  refreshDesktopCliCommandState,
} from "~/state/desktopCliCommand";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useTranslation } from "react-i18next";

export function CliCommandSettingsRow() {
  const { t } = useTranslation();
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const state = query.data;
  const [pending, setPending] = useState(false);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(refreshDesktopCliCommandState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              action === "install"
                ? t("settings.text.couldNotInstallT3")
                : t("settings.text.couldNotRemoveT3"),
            description:
              error instanceof Error ? error.message : t("settings.text.somethingWentWrong"),
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? `Another t3 at ${state.shadowedBy} runs first in a new terminal. Remove it to use Codi's.`
    : !installed
      ? "Run Codi's CLI as `t3` from any terminal."
      : state.onPath
        ? `Installed at ${state.installedPath}. Open a new terminal to use it.`
        : `Installed at ${state.installedPath}, which is not on your PATH yet. Add its folder to your PATH to run \`t3\`.`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || query.isPending || (!installed && Boolean(state.shadowedBy))}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? t("settings.text.remove") : t("settings.text.install")}
        </Button>
      }
    />
  );
}
