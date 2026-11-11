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

type CliAction = "install" | "uninstall" | "addToPath";

/** The desktop `t3` command's state, and its actions with a toast on failure. */
export function useDesktopCliCommand() {
  const { t } = useTranslation();
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const [pending, setPending] = useState(false);

  const run = (action: CliAction) => {
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
                : action === "uninstall"
                  ? t("settings.text.couldNotRemoveT3")
                  : "Could not add t3 to PATH",
            description:
              error instanceof Error ? error.message : t("settings.text.somethingWentWrong"),
          }),
        );
      })
      .finally(() => setPending(false));
  };

  return {
    state: bridge ? query.data : undefined,
    busy: pending || query.isPending,
    run,
  };
}

export function CliCommandSettingsRow() {
  const { t } = useTranslation();
  const { state, busy, run } = useDesktopCliCommand();

  if (!state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? t("settings.text.anotherT3AtShadowedbyRunsFirst", { shadowedBy: state.shadowedBy })
    : !installed
      ? t("settings.text.runCodiSCliAsT3")
      : state.onPath
        ? t("settings.text.installedAtInstalledpathOpenANew", {
            installedPath: state.installedPath,
          })
        : state.pathSetup?.added
          ? `Installed at ${state.installedPath} and added to PATH in ${state.pathSetup.file}. Open a new terminal to use it.`
          : `Installed at ${state.installedPath}, which is not on your PATH yet.${state.pathSetup ? "" : " Add its folder to your PATH to run `t3`."}`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command", t)}
      description={description}
      control={
        <div className="flex gap-2">
          {state.pathSetup && !state.pathSetup.added ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run("addToPath")}>
              Add to PATH
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (!installed && Boolean(state.shadowedBy))}
            onClick={() => run(installed ? "uninstall" : "install")}
          >
            {installed ? t("settings.text.remove") : t("settings.text.install")}
          </Button>
        </div>
      }
    />
  );
}
