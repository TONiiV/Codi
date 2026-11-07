import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import i18n from "i18next";

export interface SavedCloudEnvironmentConnectionPresentation {
  readonly buttonLabel: string;
  readonly statusText: string;
  readonly tone: "connected" | "connecting" | "error" | "idle";
}

type Phase = EnvironmentConnectionPresentation["phase"];

const PHASE_TONE: Record<Phase, SavedCloudEnvironmentConnectionPresentation["tone"]> = {
  connected: "connected",
  connecting: "connecting",
  reconnecting: "connecting",
  unsupported: "idle",
  error: "error",
  offline: "idle",
  available: "idle",
};

const PHASE_LABEL_KEY = {
  connected: "settings.parallelShared.cloudPhase_connected",
  connecting: "settings.parallelShared.cloudPhase_connecting",
  reconnecting: "settings.parallelShared.cloudPhase_reconnecting",
  unsupported: "settings.parallelShared.cloudPhase_unsupported",
  error: "settings.parallelShared.cloudPhase_error",
  offline: "settings.parallelShared.cloudPhase_offline",
  available: "settings.parallelShared.cloudPhase_available",
} as const satisfies Record<Phase, string>;

export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
): SavedCloudEnvironmentConnectionPresentation {
  return {
    buttonLabel: i18n.t(PHASE_LABEL_KEY[connection.phase]),
    statusText: connectionStatusText(connection),
    tone: PHASE_TONE[connection.phase],
  };
}
