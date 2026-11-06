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

export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
): SavedCloudEnvironmentConnectionPresentation {
  return {
    buttonLabel: i18n.t(`settings.parallelShared.cloudPhase_${connection.phase}`),
    statusText: connectionStatusText(connection),
    tone: PHASE_TONE[connection.phase],
  };
}
