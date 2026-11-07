import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@t3tools/contracts";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";
import type { TFunction } from "i18next";
import { englishT } from "~/i18n/englishT";

export function snapShotStatus(
  state: DesktopSnapShotState | null,
  enabled: boolean,
  t: TFunction = englishT,
): string {
  if (!state) return t("settings.text.checkingSnapshots");
  if (state.mode === "unavailable")
    return state.message ?? t("settings.text.notSupportedOnThisPlatform");
  if (!enabled) return t("settings.text.turnThisOnToSetUp");
  return snapShotSetupSummary(state, enabled, t);
}

export function snapShotSetupSummary(
  state: DesktopSnapShotState,
  enabled: boolean,
  t: TFunction = englishT,
): string {
  if (state.message) return t("settings.text.captureNeedsAttention");
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error"
      ? t("settings.text.checkCaptureAccessInSetup")
      : t("settings.text.installTheCaptureHelperToContinue");
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return t("settings.text.setUpActiveWindowSnapshots");
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error"
      ? t("settings.text.checkCaptureAccessInSetup")
      : t("settings.text.installTheCaptureHelperToContinue");
  if (captureSetupBackend(state) === "picker")
    return t("settings.text.manualCaptureOnlyYouLlChoose");
  if (!enabled) return t("settings.text.enableCaptureToContinue");
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? t("settings.text.connectingYourShortcut")
      : t("settings.text.waitingForShortcutPermission");
  if (state.shortcutVerified) return t("settings.text.readyToCapture");
  if (state.linuxBackend === "niri" && state.shortcutBinding)
    return t("settings.text.useYourShortcutFromAnotherApp");
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return t("settings.text.useYourShortcutFromAnotherApp");
  if (state.shortcutRegistered)
    return state.shortcutLabel
      ? t("settings.text.readyToCapture")
      : t("settings.text.shortcutSaved");
  return t("settings.text.finishShortcutSetup");
}

export function snapShotShortcutStatus(
  state: DesktopSnapShotState | null,
  t: TFunction = englishT,
): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland") return state.shortcutMessage;
  if (state.shortcutPending) return t("settings.text.approveTheShortcutPermissionPromptTo");
  if (state.shortcutRegistered)
    return state.mode === "portal" ? null : t("settings.text.shortcutSaved2");
  return state.shortcutMessage;
}

export function snapShotSetupButtonLabel(
  state: DesktopSnapShotState | null,
  t: TFunction = englishT,
): string {
  if (!state) return t("settings.text.continueSetup");
  if (captureSetupAccessReady(state)) return t("settings.text.manageCapture");
  const desktop = captureSetupDesktopName(state);
  return desktop
    ? t("settings.text.setUpDesktopCapture", { desktop })
    : t("settings.text.continueSetup");
}

export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
  t: TFunction = englishT,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? t("settings.text.captureEffectsArenTAvailableOn")
      : t("settings.text.installOrUpdateTheCaptureHelper");
  if (state.linuxBackend === "niri") return t("settings.text.captureEffectsArenTAvailableOn2");
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? t("settings.text.captureEffectsArenTAvailableOn")
      : t("settings.text.installOrUpdateTheCaptureHelper");
  return state.linuxBackend === "gnome-extension"
    ? t("settings.text.updateTheGnomeExtensionThenSign")
    : captureSetupBackend(state) === "gnome"
      ? t("settings.text.finishExtensionSetupToEnableEffects")
      : t("settings.text.captureEffectsArenTAvailableOn");
}

export function snapShotDescription(
  state: DesktopSnapShotState | null,
  t: TFunction = englishT,
): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? t("settings.text.automaticCaptureIsnTAvailableHere")
    : t("settings.text.captureAWindowAndAttachIt");
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
  t: TFunction = englishT,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return t("settings.text.thisDesktopOnlyProvidesAScreenshot");
  return undefined;
}

export function snapShotUnavailableMessage(
  hasBridge: boolean,
  t: TFunction = englishT,
): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? t("settings.text.updateTheDesktopAppToUse")
    : t("settings.text.onlyAvailableInTheDesktopApp");
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
