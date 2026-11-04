import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { readEnvironmentScope } from "../../state/session";
import { useRef, useState } from "react";
import * as Cause from "effect/Cause";
import type { SshDeviceHostConfig } from "@t3tools/contracts";
import { deviceEnvironment } from "../../state/device";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  checkDeviceHostConnections,
  deviceHostConnectionKey,
  type DeviceHostCheck,
  type DeviceHostCheckTarget,
} from "./deviceHostConnectionChecks";
import { useTranslation } from "react-i18next";

export function useHostConnectionChecks(targets: ReadonlyArray<DeviceHostCheckTarget>) {
  const { t } = useTranslation();
  const test = useAtomCommand(deviceEnvironment.testHost, { reportFailure: false });
  const [checks, setChecks] = useState<Record<string, Record<string, DeviceHostCheck>>>({});
  const running = useRef(new Set<string>());
  const testConnection = async (host: SshDeviceHostConfig) => {
    const key = deviceHostConnectionKey(host);
    if (running.current.has(key)) return;
    running.current.add(key);
    setChecks((current) => ({ ...current, [key]: {} }));
    const results: Record<string, DeviceHostCheck> = {};
    await checkDeviceHostConnections(
      targets,
      host,
      async (environmentId, input) => {
        if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) {
          throw new Error(t("settings.text.thisConnectionCannotTestDeviceHosts"));
        }
        const result = await test({ environmentId, input });
        if (result._tag === "Failure") throw new Error(Cause.pretty(result.cause));
        return result.value;
      },
      (environmentId, result) => {
        results[environmentId] = result;
        setChecks((current) => ({
          ...current,
          [key]: { ...current[key], [environmentId]: result },
        }));
      },
      t,
    ).finally(() => running.current.delete(key));
    return results;
  };
  return { checks, testConnection };
}
