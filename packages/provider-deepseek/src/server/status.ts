import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type { DeepSeekSettings } from "../settings.ts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseCliVersionResult,
  providerModelsFromSettings,
  type ProviderProbeResult,
  type ServerProviderDraft,
  providerProbeEnvironment,
  spawnAndCollect,
} from "@t3tools/provider-core/server/snapshotProbe";

const DEEPSEEK_DRIVER_KIND = ProviderDriverKind.make("deepseek");
const DEEPSEEK_PRESENTATION = {
  displayName: "DeepSeek",
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const DEEPSEEK_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoning_effort",
      label: "Reasoning",
      type: "select",
      role: "reasoning",
      currentValue: "high",
      options: [
        { id: "off", label: "Off" },
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
        { id: "max", label: "Max" },
      ],
    },
  ],
});
/** Mirrors dsh's built-in catalog; dsh refuses to switch to a model its listing does not name. */
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
const DEEPSEEK_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: DEEPSEEK_DEFAULT_MODEL,
    name: "DeepSeek-V4.1-Flash",
    isCustom: false,
    isDefault: true,
    capabilities: DEEPSEEK_CAPABILITIES,
  },
  {
    slug: "deepseek-v4-pro",
    name: "DeepSeek-V4-Pro",
    isCustom: false,
    isDefault: false,
    capabilities: DEEPSEEK_CAPABILITIES,
  },
];
const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
const VERSION_PROBE_TIMEOUT_MS = 10_000;

const snapshot = (settings: DeepSeekSettings, checkedAt: string, probe: ProviderProbeResult) =>
  buildServerProvider({
    driver: DEEPSEEK_DRIVER_KIND,
    presentation: DEEPSEEK_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: providerModelsFromSettings(
      DEEPSEEK_BUILT_IN_MODELS,
      settings.customModels,
      EMPTY_CAPABILITIES,
    ),
    probe,
  });

export const buildInitialDeepSeekProviderSnapshot = Effect.fn(
  "DeepSeekProvider.buildInitialDeepSeekProviderSnapshot",
)(function* (settings: DeepSeekSettings): Effect.fn.Return<ServerProviderDraft> {
  const now = yield* DateTime.now;
  return snapshot(settings, DateTime.formatIso(now), {
    installed: settings.enabled,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    message: settings.enabled
      ? "Checking DeepSeek Harness availability..."
      : "DeepSeek is disabled in Codi settings.",
  });
});

/** dsh signs in from DEEPSEEK_API_KEY; there is no login flow. */
export function deepSeekAuthFromEnvironment(environment: NodeJS.ProcessEnv): ServerProviderAuth {
  return environment[DEEPSEEK_API_KEY_ENV]?.trim()
    ? { status: "authenticated", type: "api_key", label: "DeepSeek API key" }
    : { status: "unauthenticated" };
}

const runDsh = Effect.fn("DeepSeekProvider.runDsh")(function* (
  settings: DeepSeekSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const command = settings.binaryPath || "dsh";
  const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  );
});

export const checkDeepSeekProviderStatus = Effect.fn("checkDeepSeekProviderStatus")(function* (
  settings: DeepSeekSettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return snapshot(settings, checkedAt, {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "DeepSeek is disabled in Codi settings.",
    });
  }

  const probeEnvironment = providerProbeEnvironment(environment);
  const versionResult = yield* runDsh(settings, ["--version"], probeEnvironment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult) || Option.isNone(versionResult.success)) {
    const missing = Result.isFailure(versionResult) && isCommandMissingCause(versionResult.failure);
    return snapshot(settings, checkedAt, {
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? "DeepSeek Harness (`dsh`) is not installed or not on PATH."
        : "Failed to run `dsh --version`.",
    });
  }
  const versionOutput = versionResult.success.value;
  const version = parseCliVersionResult(versionOutput);
  if (versionOutput.code !== 0) {
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: "DeepSeek Harness is installed but failed to run.",
    });
  }

  const auth = deepSeekAuthFromEnvironment(environment);
  if (auth.status !== "authenticated") {
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth,
      message: "Set DEEPSEEK_API_KEY in this provider's environment variables to sign in.",
    });
  }
  return snapshot(settings, checkedAt, {
    installed: true,
    version,
    status: "ready",
    auth,
  });
});
