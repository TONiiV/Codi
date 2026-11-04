import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import {
  isModifierPairShortcut,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { MacAccessibilityIcon, MacScreenRecordingIcon } from "../Icons";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";
import { Button } from "../ui/button";
import { Dialog, DialogDescription } from "../ui/dialog";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";
import {
  captureSetupAccessReady,
  captureSetupBackend,
  captureSetupCheckMessage,
  captureSetupDesktopName,
  captureSetupInitialStep,
  captureSetupShortcutReady,
  type CaptureSetupStep,
} from "./SnapShotSetupDialog.logic";
import { useTranslation } from "react-i18next";

const SETUP_STEPS = [
  { id: "access", label: "Access" },
  { id: "shortcut", label: "Shortcut" },
] as const;

const GNOME_ACCESS_COPY = {
  "not-installed": {
    title: "Install the extension",
    description:
      "The Codi GNOME extension lets you capture other windows and bring them into your draft. Sign out once after installing.",
  },
  "restart-required": {
    title: "Extension installed",
    description: "Save your work, then sign out and back in. Your setup will be waiting here.",
  },
  "update-required": {
    title: "Update the extension",
    description: "Install the update, then sign out and back in.",
  },
  "extensions-disabled": {
    title: "Allow GNOME extensions",
    description: "Open GNOME Extensions and turn on extensions, then check again.",
  },
  disabled: {
    title: "Enable the extension",
    description: "Enable Codi SnapShots to start capturing windows.",
  },
  enabled: {
    title: "Capture is ready",
    description: "Next, choose your shortcut.",
  },
  unsupported: {
    title: "Automatic capture isn't available",
    description: "Use Take snapshot from the command palette to choose a window.",
  },
  error: {
    title: "Couldn't set up the extension",
    description: "Check Codi SnapShots in GNOME Extensions, then try again.",
  },
};

export function SnapShotSetupDialog({
  state,
  initialStep,
  wasEnabled,
  includeAccessibility,
  busy: actionBusy,
  error,
  shortcutInput,
  shortcutStatus,
  shortcutChanged,
  canSaveShortcut,
  onSaveShortcut,
  onEnable,
  onAction,
  onRefresh,
  onClose,
  onLeaveStep,
}: {
  state: DesktopSnapShotState;
  initialStep: CaptureSetupStep;
  wasEnabled: boolean;
  includeAccessibility: boolean;
  busy: boolean;
  error: string | null;
  shortcutInput: ReactNode;
  shortcutStatus: string | null | undefined;
  shortcutChanged: boolean;
  canSaveShortcut: boolean;
  onSaveShortcut: () => Promise<boolean>;
  onEnable: () => Promise<boolean>;
  onAction: (action: DesktopSnapShotSetupAction) => Promise<void>;
  onRefresh: () => Promise<DesktopSnapShotState | undefined>;
  onClose: (completed: boolean) => Promise<void>;
  onLeaveStep: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(() => captureSetupInitialStep(state, initialStep));
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const busy = actionBusy || checking || configBusy;
  const backend = captureSetupBackend(state);
  const configShortcut = backend === "niri" || backend === "hyprland";
  const desktop = captureSetupDesktopName(state);
  const extension = state.gnomeExtension;
  const helper = backend === "hyprland" ? state.hyprlandHelper : state.kdeHelper;
  const helperBackend = backend === "kde" || backend === "hyprland";
  const installHelper = backend === "hyprland" ? "install-hyprland-helper" : "install-kde-helper";
  const removeHelper = backend === "hyprland" ? "remove-hyprland-helper" : "remove-kde-helper";
  const accessReady = captureSetupAccessReady(state);
  const permissionStatus = usePermissionStatus(
    async () => {
      const refreshed = await onRefresh();
      if (!refreshed?.macPermissions) throw new Error("Permission status unavailable");
      return refreshed.macPermissions;
    },
    state.macPermissions ?? { screenRecording: false, accessibility: false },
    Boolean(state.macPermissions) && step === "access" && !busy,
  );
  const macPermissions = state.macPermissions ? permissionStatus.status : undefined;
  const macPermissionsReady =
    !macPermissions ||
    permissionStatus.isReady(
      includeAccessibility ? ["screenRecording", "accessibility"] : ["screenRecording"],
    );
  const shortcutReady = captureSetupShortcutReady(state, shortcutChanged);
  const install = extension?.status === "not-installed" || extension?.status === "update-required";
  const enable = extension?.status === "disabled";
  const changeStep = (next: CaptureSetupStep) => {
    onLeaveStep();
    setChecked(false);
    setStep(next);
  };
  const checkAgain = async () => {
    if (busy) return;
    setChecking(true);
    setChecked(false);
    const refreshed = await onRefresh().finally(() => setChecking(false));
    setChecked(refreshed !== undefined);
  };
  const accessCopy =
    state.message && !macPermissions
      ? {
          title: t("settings.text.letSTryThatAgain"),
          description: t("settings.text.couldnTCheckSnapshotsTryAgain"),
        }
      : backend === "gnome" && extension
        ? extension.status === "enabled" && !accessReady
          ? {
              title: t("settings.text.checkCaptureAccess"),
              description: t("settings.text.theExtensionIsnTReadyYet"),
            }
          : GNOME_ACCESS_COPY[extension.status]
        : helperBackend
          ? helper?.status === "ready"
            ? {
                title: t("settings.text.captureIsReady"),
                description: t("settings.text.nextChooseYourShortcut"),
              }
            : helper?.status === "error"
              ? {
                  title: t("settings.text.letSFixCaptureAccess"),
                  description: t("settings.text.tryReinstallingTheCaptureHelperThen"),
                }
              : {
                  title:
                    helper?.status === "update-required"
                      ? t("settings.text.updateTheCaptureHelper")
                      : t("settings.text.allowSnapshots"),
                  description: t("settings.text.codiSCaptureHelperLetsYou"),
                }
          : backend === "niri"
            ? {
                title: t("settings.text.captureIsReady"),
                description: t("settings.text.nextChooseYourShortcut"),
              }
            : backend === "picker"
              ? {
                  title: t("settings.text.chooseAWindowEachTime"),
                  description: t("settings.text.yourDesktopDoesnTSupportAutomatic"),
                }
              : {
                  title: t("settings.text.allowSnapshots"),
                  description:
                    backend === "portal"
                      ? t("settings.text.yourDesktopMayAskForPermission")
                      : macPermissions
                        ? macPermissionsReady
                          ? t("settings.text.testASnapshotOfTheCurrent")
                          : t("settings.text.allowEachPermissionThenContinue")
                        : t("settings.text.allowAccessWhenPromptedToStart"),
                };
  const title = step === "access" ? accessCopy.title : "Choose your shortcut";
  const description =
    step === "access"
      ? accessCopy.description
      : configShortcut
        ? "Click the shortcut, then press the keys you want."
        : state.mode === "portal"
          ? "Choose your keys, then approve the permission prompt if asked."
          : "Use both Shift keys, or record a different shortcut.";
  const stepIndex = SETUP_STEPS.findIndex(({ id }) => id === step);
  const details = [
    ...new Set(
      [
        error,
        ...(step === "access"
          ? [
              state.message,
              backend === "gnome" &&
              (extension?.status === "error" || extension?.status === "unsupported")
                ? extension.message
                : null,
              helperBackend && helper?.status === "error" ? helper.message : null,
            ]
          : []),
      ].filter((detail) => detail !== null),
    ),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void onClose(false);
      }}
    >
      <WizardPopup showCloseButton={!busy}>
        <WizardHeader
          title={
            desktop
              ? t("settings.text.setUpSnapshotsForDesktop", { desktop })
              : t("settings.text.setUpSnapshots")
          }
        >
          <WizardSteps
            steps={SETUP_STEPS.map((item) => item.label)}
            currentStep={stepIndex}
            isStepDisabled={(index) => busy || index > stepIndex}
            onStepChange={(index) => {
              const next = SETUP_STEPS[index];
              if (next && next.id !== step) changeStep(next.id);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          <div className="space-y-4 text-sm">
            <div className="space-y-2" aria-live="polite">
              <h3 className="flex items-center gap-2 font-medium">{title}</h3>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {step === "access" ? (
              <>
                <p
                  role="status"
                  aria-atomic="true"
                  className={
                    checked && !busy && !error ? "text-xs text-muted-foreground" : "sr-only"
                  }
                >
                  {checked && !busy && !error ? captureSetupCheckMessage(state) : null}
                </p>
                {macPermissions ? (
                  <PermissionChecklist
                    busy={busy}
                    permissions={[
                      {
                        id: "screenRecording",
                        icon: <MacScreenRecordingIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: t("settings.text.screenRecording"),
                        description: t("settings.text.captureTheWindowYouReUsing2"),
                        granted: macPermissions.screenRecording,
                        onAllow: () => void onAction("allow-screen-recording"),
                      },
                      {
                        id: "accessibility",
                        icon: <MacAccessibilityIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: t("settings.text.accessibility"),
                        description: includeAccessibility
                          ? t("settings.text.includeTextAndControlsFromThe")
                          : t("settings.text.optionalIncludeTextAndControlsFrom"),
                        granted: macPermissions.accessibility,
                        onAllow: () => void onAction("allow-accessibility"),
                      },
                    ]}
                  />
                ) : null}
                {permissionStatus.error && macPermissions ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {permissionStatus.error}
                  </p>
                ) : null}
                {helperBackend && helper?.status === "error" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onAction(installHelper)}
                  >
                    {t("settings.text.reinstallHelper")}
                  </Button>
                ) : null}
              </>
            ) : configShortcut ? (
              <CaptureShortcutConfig
                state={state}
                disabled={actionBusy || checking || !accessReady}
                onBusyChange={setConfigBusy}
                onSaved={onRefresh}
                onComplete={() => onClose(true)}
              />
            ) : (
              <div className="space-y-3">
                {shortcutInput}
                {shortcutStatus ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {shortcutStatus}
                  </p>
                ) : null}
                {!shortcutChanged &&
                !state.shortcutRegistered &&
                !state.shortcutPending &&
                state.shortcutCanRetry !== false &&
                !isModifierPairShortcut(state.shortcut) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onAction("retry-shortcut")}
                  >
                    {state.mode === "portal"
                      ? t("settings.text.shortcutPermissions")
                      : t("settings.text.tryAgain")}
                  </Button>
                ) : null}
              </div>
            )}
            {step === "shortcut" && !accessReady ? (
              <p role="alert" className="text-destructive">
                {t("settings.text.captureNeedsAttentionGoBackTo")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {t("settings.text.couldnTFinishThisStepTry")}
              </p>
            ) : null}
            {details.length > 0 || (step === "access" && (backend === "gnome" || helperBackend)) ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t("settings.text.advanced")}</summary>
                <div className="mt-3 space-y-3">
                  {details.map((detail) => (
                    <p key={detail} className="break-words">
                      {detail}
                    </p>
                  ))}
                  {step === "access" && (backend === "gnome" || helperBackend) ? (
                    <p>{t("settings.text.includedWithCodiNoDownloadNeeded")}</p>
                  ) : null}
                  {step === "access" && backend === "gnome" && extension?.status === "enabled" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction("disable-extension")}
                    >
                      {t("settings.text.disableExtension")}
                    </Button>
                  ) : null}
                  {step === "access" && helperBackend && helper?.status !== "not-installed" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction(removeHelper)}
                    >
                      {t("settings.text.removeCaptureHelper")}
                    </Button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter>
          {step !== "access" ? (
            <Button variant="ghost" disabled={busy} onClick={() => changeStep("access")}>
              {t("settings.text.back")}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void onClose(false)}>
            {wasEnabled ? t("settings.text.close") : t("settings.text.finishLater")}
          </Button>
          {step === "access" ? (
            helperBackend && !accessReady && helper?.status !== "ready" ? (
              <Button
                disabled={busy}
                aria-busy={busy}
                onClick={() =>
                  void (helper?.status === "error" ? checkAgain() : onAction(installHelper))
                }
              >
                {checking
                  ? t("settings.text.checking")
                  : busy
                    ? t("settings.text.installing")
                    : helper?.status === "error"
                      ? t("settings.text.checkAgain")
                      : helper?.status === "update-required"
                        ? t("settings.text.updateHelper")
                        : t("settings.text.installHelper")}
              </Button>
            ) : backend === "gnome" && !accessReady && extension?.status !== "enabled" ? (
              <Button
                disabled={busy}
                aria-busy={checking}
                onClick={() =>
                  void (install
                    ? onAction("install-extension")
                    : enable
                      ? onAction("enable-extension")
                      : checkAgain())
                }
              >
                {checking
                  ? t("settings.text.checking")
                  : busy
                    ? install
                      ? t("settings.text.installing")
                      : enable
                        ? t("settings.text.enabling")
                        : t("settings.text.working")
                    : install
                      ? extension?.status === "update-required"
                        ? t("settings.text.updateExtension")
                        : t("settings.text.installExtension")
                      : enable
                        ? t("settings.text.enableExtension")
                        : t("settings.text.checkAgain")}
              </Button>
            ) : (
              <PermissionContinueButton
                ready={macPermissionsReady}
                busy={busy}
                onClick={async () => {
                  if (await onEnable()) changeStep("shortcut");
                }}
              >
                {busy
                  ? t("settings.text.working")
                  : macPermissions
                    ? t("settings.text.testCaptureAndContinue")
                    : backend === "direct"
                      ? t("settings.text.allowCapture")
                      : !accessReady && !macPermissions
                        ? t("settings.text.tryAgain")
                        : t("settings.text.continue")}
              </PermissionContinueButton>
            )
          ) : !configShortcut ? (
            <Button
              disabled={
                busy || !accessReady || (shortcutChanged ? !canSaveShortcut : !shortcutReady)
              }
              onClick={async () => {
                if (!shortcutChanged || (await onSaveShortcut())) await onClose(true);
              }}
            >
              {busy
                ? t("settings.text.saving2")
                : shortcutChanged
                  ? t("settings.text.saveAndFinish")
                  : t("settings.text.done")}
            </Button>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
