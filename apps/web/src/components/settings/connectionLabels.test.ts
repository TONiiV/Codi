import {
  connectionStatusText,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import { formatConnectReachable } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { englishT } from "~/i18n/englishT";
import { connectReachableText, connectionStatusLabel } from "./connectionLabels";

describe("connectionStatusLabel", () => {
  it("matches the shared English connection status for every phase", () => {
    const phases: ReadonlyArray<EnvironmentConnectionPhase> = [
      "available",
      "offline",
      "connecting",
      "reconnecting",
      "connected",
      "unsupported",
      "error",
    ];
    for (const phase of phases) {
      for (const error of [null, "socket closed"]) {
        const connection = { phase, error, traceId: null };
        expect(connectionStatusLabel(connection, englishT)).toBe(connectionStatusText(connection));
      }
    }
  });
});

describe("connectReachableText", () => {
  it("matches the shared English reachability summary", () => {
    for (const readyConnections of [null, 1, 2]) {
      for (const protocol of [null, "quic"] as const) {
        const reachability = {
          status: "reachable",
          checkedAt: "2026-01-01T00:00:00.000Z",
          readyConnections,
          protocol,
        } as const;
        expect(connectReachableText(reachability, englishT)).toBe(
          formatConnectReachable(reachability),
        );
      }
    }
  });
});
